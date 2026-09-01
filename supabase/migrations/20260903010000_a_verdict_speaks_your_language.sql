-- A verdict about somebody's face or somebody's livelihood, in the language
-- they speak.
--
-- The classifier is language-agnostic and that is the hard part, and it is
-- done. But two verdicts speak directly to a person about themselves and both
-- come back in English and are rendered verbatim: the selfie result on
-- src/app/verification.tsx and the storefront result on
-- src/app/business-storefront.tsx. A Thai hostel owner whose storefront photo
-- is refused gets a sentence they may not read at the exact moment the app
-- most needs to sound fair rather than arbitrary.
--
-- Three parts, and the third is the one that makes an appeal possible:
--
--   1. profiles.locale - nullable, the phone's own BCP 47 tag, written once
--      per sign-in by the client. NULL is the normal state and it falls back
--      to English SILENTLY, never to a nearest guess.
--   2. The worker passes that tag into the two prompts.
--   3. Every verdict now carries reason_en as well as reason, REQUIRED by the
--      worker's schema rather than optional, because the founder cannot
--      adjudicate an appeal against a sentence they cannot read. The verdict
--      jsonb is stored whole in moderation_events and in the request row, so
--      the English copy is in the audit trail whatever language `reason` came
--      back in.
--
-- NOTHING CHANGES ON THE MESSAGE PATH. apply_message_verdict never shows the
-- model's reason to anybody, so there is nothing there to translate and no
-- moderation outcome becomes any more visible than it was.
--
-- Recorded founder question, still open (docs/UX_PACKAGES.md
-- `hi-a-verdict-in-your-language`): is a rejection sentence written by a
-- model, in a language nobody at Samewhere reads, acceptable on a screen
-- about somebody's face or livelihood? FOR - the alternative is a sentence
-- they cannot read at all, at the moment the app most needs to sound fair.
-- AGAINST - it is unreviewable copy on the two most consequential screens the
-- app has, and the English original only helps after somebody complains.
-- Built under the blanket approval to implement every remaining package; the
-- question is recorded here so the decision stays visible.

-- ---------------------------------------------------------------------------
-- 1. The phone's language, on the profile
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists locale text
    check (locale is null or char_length(locale) <= 16);

comment on column public.profiles.locale is
  'The BCP 47 language tag the account''s phone reports, written once per '
  'sign-in and used only to choose the language of a moderation verdict '
  'addressed to this person. NULL means English, silently - never a nearest '
  'guess. Not profile content: it is never rendered on a profile and no '
  'discovery surface reads it.';

-- UPDATE ONLY, and deliberately no select grant.
--
-- profiles carries column-level grants (20260816190000:350 and :354) exactly
-- so that every column on it is opt-in, and the two policies on the table are
-- profiles_select_own AND profiles_select_visible - so a select grant here
-- would hand every traveler who can see you your phone's language along with
-- your bio. Nothing in the app reads it back: the client writes it and the
-- worker reads it as the service role, which is covered by the table-level
-- grant that role already has. The app never star-reads profiles
-- (31_select_star_stays_readable keeps it off that list), so an ungranted
-- column breaks nothing.
grant update (locale) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The founder's copy of a verdict stays English
-- ---------------------------------------------------------------------------
--
-- One line changes in the function below and it is the whole reason this
-- section exists. An 'uncertain' storefront mails the FOUNDER, who has to
-- finish the call by hand, and it quoted `reason` - which from this deploy
-- onward may be in Thai. The business's own mail and the row's own `reason`
-- column stay in the owner's language, because those are read by the owner.
-- Only the one addressed to the person who cannot read it prefers reason_en,
-- and it falls back to `reason` so a verdict written before this deploy still
-- says something.
--
-- The definition below is the CURRENT one, taken from
-- 20260827160000_places_polish.sql:121-205 (the newest `create or replace` of
-- this function), with that single coalesce changed. It returns void, so no
-- OUT column moves and no drop-function dance is needed; `create or replace`
-- also keeps the existing grants, which the revoke at
-- 20260827120000_business_listing.sql:473 already set.

create or replace function public.apply_business_verification_verdict(
  p_request_id uuid,
  p_verdict jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.business_verifications%rowtype;
  v_action text := p_verdict ->> 'action';
begin
  perform public.assert_service_caller();

  select * into v_row from public.business_verifications
   where id = p_request_id for update;
  if not found then
    raise exception 'verification request not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'verification request is not pending';
  end if;

  if v_action = 'approve' then
    update public.business_verifications
       set status = 'approved', verdict = p_verdict, reviewed_at = now(), reason = null
     where id = p_request_id;
    update public.businesses set verified_at = now() where id = v_row.business_id;
    insert into public.outbound_mail (to_address, subject, text_body, kind)
    select c.email, 'You are verified on Samewhere',
           concat(b.name, ' now shows the verified check on its page. Nothing ',
                  'else changes, and you can put more up whenever you like.'),
           'business_verified'
      from public.businesses b
      join public.business_email_confirmations c on c.business_id = b.id
     where b.id = v_row.business_id;
  elsif v_action = 'uncertain' then
    -- Terminal for the machine, open for a person:
    -- admin_resolve_business_verification below is the way back in. The
    -- founder gets the mail; the business gets a screen that says a person is
    -- looking, and now that is true rather than a place the row goes to die.
    update public.business_verifications
       set status = 'uncertain', verdict = p_verdict, reviewed_at = now(),
           reason = coalesce(p_verdict ->> 'reason', null)
     where id = p_request_id;
    insert into public.outbound_mail (subject, text_body, kind)
    select concat('Storefront photo needs a look: ', b.name),
           concat('Business: ', b.name, E'\n',
                  'Request: ', p_request_id::text, E'\n',
                  'Model said: ', coalesce(p_verdict ->> 'reason_en',
                                          p_verdict ->> 'reason',
                                          '(no reason given)'), E'\n\n',
                  'To finish it: select public.admin_resolve_business_verification(''',
                  p_request_id::text, ''', true);  -- or false, with a reason')
      from public.businesses b where b.id = v_row.business_id;
  else
    update public.business_verifications
       set status = 'rejected', verdict = p_verdict, reviewed_at = now(),
           reason = coalesce(
             p_verdict ->> 'reason',
             'We could not match those photos to the business. Try again in daylight, with the sign in frame.'
           )
     where id = p_request_id;
    -- The screen shows the reason too, but somebody who sent their photos and
    -- put the phone away has no reason to open the app again. The approval
    -- mails; so should this.
    insert into public.outbound_mail (to_address, subject, text_body, kind)
    select c.email, concat('That storefront photo did not pass: ', b.name),
           concat('We could not match those photos to ', b.name, '.', E'\n\n',
                  coalesce(p_verdict ->> 'reason', ''), E'\n\n',
                  'Open Samewhere and have another go. Same two shots: one from ',
                  'across the street with the whole front in, one near enough to ',
                  'read the sign.'),
           'business_verification_rejected'
      from public.businesses b
      join public.business_email_confirmations c on c.business_id = b.id
     where b.id = v_row.business_id;
  end if;

  insert into public.moderation_events
    (subject_business_id, entity_type, entity_id, action, source, metadata)
  values (v_row.business_id, 'business_verification', p_request_id,
          concat('business_verification_', coalesce(v_action, 'reject')),
          'automated', p_verdict);
end
$$;
