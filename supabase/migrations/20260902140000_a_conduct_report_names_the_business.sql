-- A CONDUCT REPORT THAT NEITHER SUBJECT QUERY CAN FIND
--
-- 20260902110000 raises a moderation_events row for a report about how a
-- business behaved, so that it lands beside the reports about people rather
-- than in a pile nobody built a screen for. It sets `subject_user_id` to the
-- owner and leaves `subject_business_id` null.
--
-- For a CLAIMED business that is merely incomplete. For an UNCLAIMED venue it
-- is a hole: owner_user_id is null there, so both subject columns are null
-- and the row is reachable by neither of the spine's two subject queries -
-- not by "complaints against this account", and not by the
-- (subject_business_id, created_at desc) index 20260827120000:30 built for
-- "everything filed about this business". The event exists and answers no
-- question anybody asks. An unclaimed venue is precisely where a conduct
-- report has no owner to hang on, which makes this the case that needed the
-- business column most.
--
-- Every other business moderation event in the schema already sets it
-- (20260827120000:466 and :720). This one now does too, and keeps the owner
-- when there is one, so a complaint about a claimed business still shows up
-- in the count against that account.

create or replace function public.on_business_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_city text;
  v_owner uuid;
  v_conduct boolean;
begin
  select b.name, c.name, b.owner_user_id into v_name, v_city, v_owner
    from public.businesses b join public.cities c on c.id = b.city_id
   where b.id = new.business_id;

  -- Read the file header of 20260902110000 before rewriting this as
  -- `in ('harassment_or_conduct', 'unsafe')`. Naming a label added higher up
  -- in the same file is what kills the deploy half way through. The same five
  -- accuracy reasons are named by business_reports.is_conduct
  -- (20260902130000), and the two must stay identical.
  v_conduct := new.reason::text not in (
    'not_a_real_place', 'permanently_closed', 'not_this_business',
    'wrong_location', 'spam_or_offensive'
  );

  insert into public.outbound_mail (subject, text_body, kind)
  values (
    concat(case when v_conduct then 'Conduct report: ' else 'Reported: ' end, v_name),
    concat_ws(E'\n',
      case when v_conduct then
        'Somebody reported how this business behaved.'
      else
        'Somebody reported this listing.'
      end,
      concat('Business: ', v_name, ' (', v_city, ')'),
      concat('Reason: ', new.reason::text),
      concat('Note: ', coalesce(new.note, '-')),
      concat('Business id: ', new.business_id)
    ),
    'business_reported'
  );

  if v_conduct then
    insert into public.moderation_events
      (subject_user_id, subject_business_id, entity_type, entity_id,
       action, source, metadata)
    values
      (v_owner, new.business_id, 'business', new.business_id,
       'conduct_report', 'user_report',
       jsonb_build_object('report_id', new.id,
                          'reason', new.reason::text,
                          'business_id', new.business_id));
  end if;

  -- One scan a day per business. Two people reporting the same bar within an
  -- hour is one question, not two, and the email still goes out for both
  -- because the founder asked to see them.
  if not exists (
    select 1 from public.business_scans
    where business_id = new.business_id and created_at > now() - interval '24 hours'
  ) then
    insert into public.business_scans (business_id, trigger_report_id)
    values (new.business_id, new.id);
  end if;

  return new;
end
$$;

revoke execute on function public.on_business_report() from public, anon, authenticated;
