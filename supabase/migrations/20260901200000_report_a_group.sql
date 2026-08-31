-- A group can be reported, and a report need not name a person.
--
-- The whole reporting path was per-person: reports.reported_user_id was NOT
-- NULL and the form required a userId, so a room that had gone bad had no exit
-- that told anybody. An unnamed group report is the only honest shape when the
-- problem is the room itself rather than one person in it, so this drops the
-- NOT NULL rather than making the reporter pick somebody.
--
-- Relaxing a NOT NULL on this table touches the moderation pipeline, so every
-- reader of public.reports was audited before it landed. The two triggers are
-- fine as they are: log_report writes moderation_events.subject_user_id, which
-- is nullable (20260816190000:90), and pushes to whoever is on support duty
-- rather than to the reported account; throttle_reports counts by reporter.
-- The two that needed changing are below: the triage view, whose join would
-- have swallowed a subjectless report silently, and admin_resolve_report,
-- whose person-actions have nobody to act on.

alter table public.reports
  add column reported_chat_id uuid references public.chats (id) on delete cascade;

alter table public.reports
  alter column reported_user_id drop not null;

alter table public.reports
  add constraint reports_has_a_subject
  check (reported_user_id is not null or reported_chat_id is not null);

-- THE COLUMN-GRANT TRAP. `reports` carries COLUMN-level select grants
-- (20260816220000:128), so Postgres refuses `select *` on it the moment an
-- ungranted column appears. The new column is granted to authenticated here,
-- in the same migration, and deliberately NOT to anon: `revoke all on
-- public.reports from anon` is the standing rule for this table and a report
-- is nobody's business but its reporter's and the reviewer's.
grant select (reported_chat_id) on public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- Filing one
-- ---------------------------------------------------------------------------
--
-- A chat report additionally requires being IN the chat. Without that, the
-- reports table becomes a way to probe which chat ids exist and to file
-- reports against rooms somebody has never been in.

drop policy reports_insert_own on public.reports;

create policy reports_insert_own
  on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and (
      reported_chat_id is null
      or public.is_room_member(reported_chat_id)
      or public.is_chat_member(reported_chat_id)
    )
  );

-- ---------------------------------------------------------------------------
-- The triage queue: a group report must not vanish into a join
-- ---------------------------------------------------------------------------
--
-- The view inner-joined public.users on reported_user_id, so a report with no
-- person on it would have disappeared from the reviewer's queue entirely —
-- filed, acknowledged, and read by nobody. LEFT JOIN, plus the chat this is
-- about and what it is called, so a reviewer can see which room they are being
-- asked to look at.
--
-- Body restated whole from 20260901120100:22, with the join relaxed and two
-- columns added.

drop view if exists public.admin_report_queue;

create view public.admin_report_queue as
select
  r.id,
  r.created_at,
  r.reason,
  r.details,
  r.context,
  r.reporter_id,
  r.reported_user_id,
  r.reported_chat_id,
  -- What the room is called, for a report that names one. Groups have names;
  -- a business room is named by its business.
  coalesce(
    (select g.name from public.groups g where g.chat_id = r.reported_chat_id),
    (select b.name from public.businesses b where b.chat_id = r.reported_chat_id)
  ) as reported_chat_name,
  u.status as reported_user_status,
  (select count(*) from public.moderation_events e
    where e.subject_user_id = r.reported_user_id
      and public.is_strike_action(e.action)) as reported_user_strikes,
  (select count(*) from public.reports r2
    where r2.reported_user_id = r.reported_user_id) as total_reports_against
from public.reports r
left join public.users u on u.id = r.reported_user_id
where r.status = 'open'
order by (r.reason::text in ('underage', 'immediate_danger')) desc, r.created_at;

revoke all on public.admin_report_queue from anon, authenticated;

comment on view public.admin_report_queue is
  'Open reports for a human reviewer, urgent claims first (D34: priority, '
  'never automatic suppression). A report may name a chat instead of a person, '
  'so the user join is outer. Service role only.';

-- ---------------------------------------------------------------------------
-- Resolving one
-- ---------------------------------------------------------------------------
--
-- Every action but 'dismiss' acts on a person. Against a report that names
-- only a chat, 'warn' would push to a null user_id and the three status
-- actions would update no rows and raise something that says nothing about the
-- real cause. Refused up front instead, in a sentence that says what to do.
--
-- Body restated whole from 20260901130000:111, with the guard added.

create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_action text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports%rowtype;
  v_rows int;
begin
  perform public.assert_service_caller();
  if p_action not in ('dismiss', 'warn', 'strike', 'suspend', 'ban', 'shadowban') then
    raise exception 'unknown action %', p_action;
  end if;

  select * into v_report
  from public.reports
  where id = p_report_id and status = 'open'
  for update;
  if not found then
    raise exception 'report not open';
  end if;

  if v_report.reported_user_id is null and p_action <> 'dismiss' then
    raise exception 'this report names a chat and not a person: act on somebody in it, or dismiss';
  end if;

  if p_action = 'warn' then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'warning_issued', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
    insert into public.push_queue (user_id, title, body, data)
    values (v_report.reported_user_id, 'House rules warning',
            'A person read a report about your account and agreed with it. More of it will pause your account.',
            jsonb_build_object('type', 'moderation'));
  elsif p_action = 'strike' then
    -- The strike policy trigger handles any resulting warn/suspend/ban.
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_strike', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  elsif p_action = 'suspend' then
    -- Applies to active accounts (or extends an existing suspension). Never
    -- overwrites a shadowban — lift_expired_suspensions would launder it into
    -- 'active' — and never downgrades a ban. Audit events are only written
    -- for state changes that actually happened.
    update public.users
      set status = 'suspended', suspended_until = now() + interval '7 days'
      where id = v_report.reported_user_id and status in ('active', 'suspended');
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'suspend does not apply to this account''s status';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_suspended', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  elsif p_action = 'ban' then
    update public.users
      set status = 'banned', suspended_until = null
      where id = v_report.reported_user_id and status <> 'banned';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'account is already banned';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_banned', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  elsif p_action = 'shadowban' then
    update public.users
      set status = 'shadowbanned', suspended_until = null
      where id = v_report.reported_user_id and status <> 'banned';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'cannot shadowban a banned account';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_shadowbanned', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  end if;

  update public.reports
    set status = 'resolved:' || p_action
    where id = p_report_id;
end
$$;

-- Grants restated after the replace, per this repo's rule.
revoke execute on function public.admin_resolve_report(uuid, text, text)
  from public, anon, authenticated;
