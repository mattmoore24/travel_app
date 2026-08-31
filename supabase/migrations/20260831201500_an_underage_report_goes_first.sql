-- An underage report goes to the front of the review queue.
--
-- Decision D34: no auto-suppression on a single report. One person typing
-- "they are under 18" must not be able to take somebody's account down, and
-- a claim that costs nothing to make is a claim somebody will make out of
-- spite. What it does buy is priority: the report sorts first and a human
-- decides, in minutes rather than after everything filed before it.
--
-- `create or replace view` keeps the view's grants and its column list is
-- unchanged, so nothing has to be re-stated here. The revoke is restated
-- anyway because this view must never be readable by a client, and a line
-- that says so is cheaper than trusting that nobody ever drops it.
--
-- The comparison is `reason::text`, not the enum literal. 20260831200000 adds
-- the label; naming it as an enum constant here would resolve it at DDL time,
-- and if a deploy ever applies both files inside one transaction Postgres
-- answers "unsafe use of new value" and the whole migration fails. Casting to
-- text never touches the label at all.
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
order by (r.reason::text = 'underage') desc, r.created_at;

revoke all on public.admin_report_queue from anon, authenticated;

comment on view public.admin_report_queue is
  'Open reports for a human reviewer, underage claims first (D34: priority, '
  'never automatic suppression). Service role only.';
