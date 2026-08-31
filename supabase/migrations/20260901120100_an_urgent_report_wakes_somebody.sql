-- An urgent report goes to the front AND wakes a phone.
--
-- Decision D34 stands and this file does not touch it: one report never
-- suppresses anybody. A claim that costs nothing to make is a claim somebody
-- will make out of spite, and a one-tap way to darken a stranger is exactly
-- the trade this codebase already refused once for business reports. What an
-- urgent report buys is ATTENTION: it sorts first, and now it also raises a
-- push, so a minor on the platform or a frightened traveler does not wait for
-- somebody to happen to open the SQL editor.
--
-- 'immediate_danger' is added by 20260901120000 and is first used here,
-- because Postgres refuses to use a new enum label in the transaction that
-- created it. Every comparison below is on `reason::text` rather than the
-- enum literal, the same way 20260831201500 does it: a text comparison never
-- resolves the label at DDL time, so even a deploy that applied both files in
-- one transaction would not answer "unsafe use of new value".

-- ---------------------------------------------------------------------------
-- The queue: both urgent reasons first, then age
-- ---------------------------------------------------------------------------

create or replace view public.admin_report_queue as
select
  r.id,
  r.created_at,
  r.reason,
  r.details,
  r.context,
  r.reporter_id,
  r.reported_user_id,
  u.status as reported_user_status,
  (select count(*) from public.moderation_events e
    where e.subject_user_id = r.reported_user_id
      and public.is_strike_action(e.action)) as reported_user_strikes,
  (select count(*) from public.reports r2
    where r2.reported_user_id = r.reported_user_id) as total_reports_against
from public.reports r
join public.users u on u.id = r.reported_user_id
where r.status = 'open'
order by (r.reason::text in ('underage', 'immediate_danger')) desc, r.created_at;

revoke all on public.admin_report_queue from anon, authenticated;

comment on view public.admin_report_queue is
  'Open reports for a human reviewer, urgent claims first (D34: priority, '
  'never automatic suppression). Service role only.';

-- ---------------------------------------------------------------------------
-- The push: somebody hears about it
-- ---------------------------------------------------------------------------

-- Body copied from 20260816220000_chat_realtime.sql:132, with the audit-spine
-- insert untouched and a push added for the two urgent reasons only. It
-- reuses support_duty_user_ids() (20260821150000) rather than inventing a
-- second list of moderators: there is one person on duty and one place that
-- says who, and a setting that has to be filled in twice is a setting that
-- gets filled in once.
--
-- Never raises. support_duty_user_ids() is written not to, and the push is
-- only the notification: a notification that can veto a safety report has the
-- priority exactly backwards.
--
-- The payload names no screen on purpose. There is no in-app review queue -
-- the reviewer works in the dashboard (docs/DASHBOARD.md) - and routeForPayload
-- returns null for an unknown type, so tapping the notification opens the app
-- rather than dropping somebody on a screen that cannot help.
create or replace function public.log_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values
    (new.reported_user_id, 'report', new.id, 'filed', 'user_report',
     jsonb_build_object('reason', new.reason, 'context', new.context));

  if new.reason::text in ('underage', 'immediate_danger') then
    insert into public.push_queue (user_id, title, body, data)
    select d.id,
           case new.reason::text
             when 'underage' then 'Report: under 18'
             else 'Report: somebody in danger'
           end,
           'It is at the front of the review queue. Nobody has been suspended by it.',
           jsonb_build_object('type', 'report', 'report_id', new.id)
    from public.support_duty_user_ids() as d(id)
    where d.id is distinct from new.reporter_id;
  end if;

  return new;
end
$$;

revoke execute on function public.log_report() from public, anon, authenticated;
