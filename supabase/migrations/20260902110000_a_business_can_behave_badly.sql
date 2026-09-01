-- A business can behave badly, and until now a traveler could not say so.
--
-- The five reasons `business_report_reason` carried are all complaints about
-- the LISTING: it is not the real business, it does not exist, it is closed,
-- it is in the wrong spot, it is spam. Four map-accuracy questions and one
-- catch-all. But the businesses on this map are hostels and bars, which is to
-- say they are the physical rooms this app encourages strangers to walk into
-- and meet each other in. A woman harassed by whoever is behind a hostel's
-- account had no honest option on that form, and reporting the individual was
-- no better: the chat header pushed /report with `chat.other_user_id`, which
-- on a business thread is the owner as a private person, so the report landed
-- in the person queue named after the wrong subject.
--
-- Two labels, and the escalation trigger learns to tell the two kinds apart.
--
-- WHY THE FUNCTION NEVER NAMES THE NEW LABELS. Postgres refuses to USE an
-- enum label in the transaction that added it, and `supabase db push` runs a
-- migration file inside one transaction - so a file that adds a label and
-- then evaluates an expression naming it dies AFTER the label has already
-- landed, leaving the database half migrated. That is the failure
-- 20260831200000 and 20260901120000 each carry a paragraph about, and both of
-- them answered it by splitting the file in two. There is no second file
-- here, so the question is asked from the other end instead: a report is
-- about CONDUCT when its reason is not one of the five listing-accuracy
-- reasons, every one of which already existed before this migration ran. The
-- inversion is not only safe, it is the more honest sentence: the queue wants
-- to know whether somebody is complaining about the pin or about the people,
-- and any reason added later that is about the people is on the right side of
-- the line by default.

alter type public.business_report_reason add value if not exists 'harassment_or_conduct';
alter type public.business_report_reason add value if not exists 'unsafe';

/**
 * What happens on a report: an email, always, and a scan unless one has run
 * in the last day - and now, for a report about how the business behaved, a
 * row in the moderation spine as well.
 *
 * **[founder]** the scan is on the FIRST report rather than the third. The
 * machine read is cheap, and it is the thing that keeps the queue short
 * enough that "I'll handle the rest by hand" is a real plan rather than a
 * theoretical one.
 *
 * The moderation_events row is what puts a conduct report beside a report
 * about a person rather than in a separate pile nobody built a screen for.
 * `subject_user_id` is the owner, so the same count that answers "how many
 * complaints are there against this account" sees it; the ACTION is
 * deliberately not a strike action (see is_strike_action, 20260817090000), so
 * an accusation still cannot suspend anybody on its own. A verdict is a human
 * being's job.
 *
 * An unclaimed launch venue has no owner and `subject_user_id` is nullable,
 * so read it rather than assuming one: a conduct report about a bar nobody
 * has claimed is still worth recording.
 *
 * Nothing here reaches the reporter. This is an AFTER INSERT trigger on a
 * table the reporter holds no grant on, and report_business() returns void
 * either way, so the acknowledgement the app shows is the same sentence
 * whatever the queue does next - which is the point.
 */
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

  -- Read the file header before rewriting this as `in ('harassment_or_conduct',
  -- 'unsafe')`. Naming a label added higher up in the same file is what kills
  -- the deploy half way through.
  v_conduct := new.reason::text not in (
    'not_a_real_place', 'permanently_closed', 'not_this_business',
    'wrong_location', 'spam_or_offensive'
  );

  insert into public.outbound_mail (subject, text_body, kind)
  values (
    concat(case when v_conduct then 'Conduct report: ' else 'Reported: ' end, v_name),
    concat(
      case when v_conduct then
        concat(
          'This one is about how the business treated somebody, not about ',
          'whether the listing is accurate. It is in the moderation queue ',
          'as well.', E'\n\n'
        )
      else '' end,
      'Business: ', v_name, ' (', coalesce(v_city, 'unknown city'), ')', E'\n',
      'Business id: ', new.business_id::text, E'\n',
      'Reason: ', new.reason::text, E'\n',
      'Note: ', coalesce(new.note, '(none)'), E'\n',
      'Report id: ', new.id::text, E'\n\n',
      'A check of the whole listing has been queued. If it comes back as ',
      'plausible impersonation the listing goes dark straight away and you ',
      'get a second mail; otherwise it stays up and waits for you.'
    ),
    'business_reported'
  );

  if v_conduct then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_owner, 'business', new.business_id, 'conduct_report', 'user_report',
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

-- `create or replace` keeps both the trigger and the grants, and the grant on
-- this one is an absence: nobody may call it by hand. Re-stated so a reader of
-- this file can see that without going back two migrations.
revoke execute on function public.on_business_report() from public, anon, authenticated;
