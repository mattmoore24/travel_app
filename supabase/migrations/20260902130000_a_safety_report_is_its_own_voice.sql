-- ONE VOICE PER KIND, NOT ONE VOICE EVER
--
-- `business_reports_one_voice` (20260827120000:535) is unique on
-- (business_id, reporter_user_id), and report_business inserts
-- `on conflict ... do nothing`. That was written for listing-accuracy
-- reports, and for those it is right: without it, "the first report from an
-- account triggers a scan" reads as "one account can trigger a scan as often
-- as it likes".
--
-- 20260902110000 then routed a new KIND of report through the same table: a
-- report about how the business behaved, which raises a moderation_events row
-- beside the reports about people. The index does not know the difference. So
-- a traveler who once reported a listing for wrong hours, and later has
-- something to say about harassment, inserts nothing at all: no row, no
-- trigger, no email, no moderation event. report_business returns void, so
-- the app says it went through. A safety report silently discarded because
-- the same person once fixed an address is the worst shape this can take.
--
-- One voice per KIND keeps the original guarantee - an account still cannot
-- trigger scans repeatedly, and still cannot file the same complaint twice -
-- while letting the two different things be said once each.
--
-- The split is by the same inversion 20260902110000 argued for and for the
-- same reason: a report is about CONDUCT when its reason is NOT one of the
-- five listing-accuracy reasons. Naming the accuracy list rather than the
-- conduct list means a reason added later is on the safety side of the line
-- by default, which is the side where a mistake is survivable. The labels are
-- all committed by now (they were added in an earlier migration), so naming
-- them here is safe - the hazard that file's header warns about is using a
-- label in the same transaction that adds it.

alter table public.business_reports
  add column if not exists is_conduct boolean
  -- The enum values themselves, NOT reason::text. Postgres rejects the cast
  -- in a generated column ("generation expression is not immutable"): an
  -- enum's labels can be renamed, so enum-to-text is only STABLE. Enum
  -- equality is immutable, and comparing the values directly says the same
  -- thing without the cast.
  generated always as (
    reason not in (
      'not_a_real_place'::public.business_report_reason,
      'permanently_closed'::public.business_report_reason,
      'not_this_business'::public.business_report_reason,
      'wrong_location'::public.business_report_reason,
      'spam_or_offensive'::public.business_report_reason
    )
  ) stored;

comment on column public.business_reports.is_conduct is
  'Whether this report is about how the business behaved rather than whether '
  'the listing is accurate. Generated, and by inversion: any reason that is '
  'not one of the five accuracy reasons counts as conduct, so a reason added '
  'later lands on the safety side by default.';

-- Safe to build: the index it replaces was STRICTER (unique on two columns
-- where this is unique on three), so no existing pair of rows can collide.
drop index if exists public.business_reports_one_voice;

create unique index business_reports_one_voice
  on public.business_reports (business_id, reporter_user_id, is_conduct)
  where reporter_user_id is not null;

create or replace function public.report_business(
  p_business_id uuid,
  p_reason public.business_report_reason,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_business_account(v_user) then
    raise exception 'a business account cannot do that' using errcode = '42501';
  end if;
  if not public.is_visible_business(p_business_id) then
    raise exception 'business not found';
  end if;
  if public.owns_business(p_business_id) then
    raise exception 'that is your own listing';
  end if;

  -- The conflict target names the same three columns as the index, so a
  -- second report of the SAME kind is still the no-op it has always been,
  -- and a report of the other kind is heard.
  insert into public.business_reports (business_id, reporter_user_id, reason, note)
  values (p_business_id, v_user, p_reason, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (business_id, reporter_user_id, is_conduct) where reporter_user_id is not null
  do nothing;
end
$$;

revoke execute on function public.report_business(uuid, public.business_report_reason, text)
  from public, anon;
grant execute on function public.report_business(uuid, public.business_report_reason, text)
  to authenticated;
