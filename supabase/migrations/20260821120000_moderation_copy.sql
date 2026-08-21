-- Two moderation notices a person reads on a lock screen.
--
-- Both said: "... This app is for platonic travel friends — further
-- violations will suspend your account."
--
-- Two problems. The em dash is on this project's banned list and this was the
-- last pair of them in anything a user sees. And "this app is for platonic
-- travel friends" is a phrase the founder had already struck from every other
-- surface in the copy pass, because opening a warning by defining what the
-- app is reads as a lecture rather than as a consequence — and a push
-- notification is read by whoever is looking at the phone, not only by the
-- person it is about.
--
-- The sentence that survives says the one thing that matters. Both bodies are
-- copied verbatim from 20260817090000_trust_safety.sql with only that string
-- changed.

-- public.apply_strike_policy
create or replace function public.apply_strike_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_status public.user_status;
begin
  if new.subject_user_id is null or not public.is_strike_action(new.action) then
    return new;
  end if;

  -- Serialize per-user so concurrent strikes can't both read a stale count.
  perform pg_advisory_xact_lock(hashtext('strikes:' || new.subject_user_id::text));

  select count(*) into v_count
  from public.moderation_events
  where subject_user_id = new.subject_user_id
    and public.is_strike_action(action);

  select status into v_status from public.users where id = new.subject_user_id;
  if v_status is null or v_status = 'banned' then
    return new;
  end if;

  if v_count >= 7 then
    update public.users
      set status = 'banned', suspended_until = null
      where id = new.subject_user_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'banned', 'strike_policy',
       jsonb_build_object('strike_count', v_count));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'Account banned',
            'Your account has been permanently banned for repeated guideline violations.',
            jsonb_build_object('type', 'moderation'));
  -- Suspension applies only to plain-active accounts: suspending a
  -- shadowbanned user would both reveal the shadowban (gate screen) and
  -- launder it into 'active' when lift_expired_suspensions runs. Shadowbanned
  -- accounts still hit the ban rung at 7.
  elsif v_count >= 5 and v_status = 'active' then
    update public.users
      set status = 'suspended', suspended_until = now() + interval '7 days'
      where id = new.subject_user_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'suspended', 'strike_policy',
       jsonb_build_object('strike_count', v_count, 'days', 7));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'Account suspended',
            'Your account is suspended for 7 days for repeated guideline violations.',
            jsonb_build_object('type', 'moderation'));
  elsif v_count >= 3 and not exists (
    select 1 from public.moderation_events
    where subject_user_id = new.subject_user_id and action = 'warning_issued'
  ) then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'warning_issued', 'strike_policy',
       jsonb_build_object('strike_count', v_count));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'Community guidelines warning',
            'Recent messages or photos broke our guidelines. More of it will suspend your account.',
            jsonb_build_object('type', 'moderation'));
  end if;
  return new;
end
$$;

-- public.admin_resolve_report
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

  if p_action = 'warn' then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'warning_issued', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
    insert into public.push_queue (user_id, title, body, data)
    values (v_report.reported_user_id, 'Community guidelines warning',
            'A report against your account was reviewed. More of it will suspend your account.',
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
revoke execute on function public.apply_strike_policy() from public, anon, authenticated;
revoke execute on function public.admin_resolve_report(uuid, text, text) from public, anon, authenticated;
