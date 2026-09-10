-- The words the app refuses are slurs, and only slurs.
--
-- Founder, 2026-09-10, verbatim: "I don't think we need to flag any of those
-- four words as they might be used commonly in chats without necessarily
-- being explicit content. While I agree photos should be screened for
-- explicit content, I don't think we should be trying to police speech
-- rather than a few explicit curse words that are almost always used in a
-- derogatory fashion (think the n word and other words similar to that) and
-- can rely on users to report/block each other if they don't like the text
-- users are using. This would require more manual review and may be worth
-- revisiting once we have a large user base, but for now I think is fine."
--
-- WHAT THIS CHANGES. public.moderation_blocklist held eleven patterns from
-- the first cut of the app, all of them about flirtation or sex: nudes,
-- dtf, fwb, hook up, sexy, sexting, netflix and chill, and so on. They were
-- written for a first message between strangers, and against a public plan
-- on a map they refuse ordinary travel English ("hook up with the others at
-- 10" is British and Australian for "meet up"), real venues ("Sexy Fish",
-- "Nude Espresso"), and a film title. Every refusal is invisible after the
-- fact, because the raise rolls the audit row back with it.
--
-- They are replaced by identity slurs: words with no ordinary use in a
-- friendly conversation between travelers. The list is deliberately short.
-- Ordinary profanity is NOT here on purpose: the founder's rule is about
-- words "almost always used in a derogatory fashion", and words that are
-- merely coarse are for the report and block buttons, which every chat,
-- profile and pin already has.
--
-- WHAT THIS DOES NOT CHANGE. screen_first_message's seam is untouched: every
-- surface that calls it (profiles, prompts, priorities, businesses, business
-- posts, first messages, pins) keeps calling it and keeps refusing on a
-- match. Photo screening is untouched. The LLM review of a held first
-- message is a worker change shipped alongside this file, for the same
-- reason: it stops blocking on "flirtation" and "sexual" and keeps blocking
-- on harassment, spam and scams.
--
-- ONE TRANSACTION, as every migration here is now.

begin;

-- 1. THE OLD WORDS GO. By content, not by id: ids are serial and differ
--    between this database and a fresh one.
delete from public.moderation_blocklist
where category in ('sexual', 'flirtation');

-- 2. THE SLURS. Case-insensitive Postgres regexes with word boundaries, like
--    the rows they replace. Repeated letters are absorbed where a common
--    spelling stretches them; nothing here tries to defeat deliberate
--    obfuscation, because a substring blocklist never can and the report
--    button is the second half of the founder's rule.
--
--    Words with a common innocent meaning in a launch city's language are
--    deliberately absent, whatever their history: "negro" is the colour
--    black in Portuguese and Spanish, two of the four launch cities speak
--    them, and a colour is not a slur.
insert into public.moderation_blocklist (pattern, category) values
  ('\yn+[i1]+g+(e+r+|a+|a+h+|u+h+)s?\y', 'slur'),
  ('\yfagg?[o0]ts?\y', 'slur'),
  ('\ydykes?\y', 'slur'),
  ('\ytrann(y|ies|ie)\y', 'slur'),
  ('\yshemales?\y', 'slur'),
  ('\yretard(s|ed)?\y', 'slur'),
  ('\ykikes?\y', 'slur'),
  ('\ych[i1]nks?\y', 'slur'),
  ('\ygooks?\y', 'slur'),
  ('\ysp[i1]cs?\y', 'slur'),
  ('\ywetbacks?\y', 'slur'),
  ('\yragheads?\y', 'slur'),
  ('\ytowelheads?\y', 'slur'),
  ('\ypakis?\y', 'slur'),
  ('\ybeaners?\y', 'slur'),
  ('\ykaffirs?\y', 'slur'),
  ('\ysand\s*n+[i1]+g+(e+r+|a+)s?\y', 'slur');

comment on table public.moderation_blocklist is
  'The words the app refuses outright, in every text a person writes. Since '
  '2026-09-10 these are identity slurs only (founder: "a few explicit curse '
  'words that are almost always used in a derogatory fashion"). Anything '
  'merely coarse, flirtatious or sexual is for the report and block buttons, '
  'not for this table. Category is ''slur'' for every row.';

-- 3. A GROUP'S NAME IS TYPED BY A PERSON, so it is screened like every other
--    thing a person types. It was the one text a traveler composes that
--    nothing checked, and it is also the most permanent: a group has no
--    expiry, and its name is the title of every push its members get.
--
--    Only the TYPED path. post_joinable_pin also names a group, from the
--    plan text (already screened at the pin) or the venue name (exempt by
--    the founder's ruling of the same day), and that path is left alone so
--    the venue-name exemption is not quietly undone one table over.
create or replace function public.create_group(
  p_name text,
  p_max_stay_until date,
  p_speaking public.group_speaking default 'everyone',
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chat uuid;
  v_recent int;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  perform public.assert_not_business('start a group');

  -- The one thing a traveler composes that nothing checked. Same seam,
  -- same error, same hint as every other typed field, so the client's
  -- existing sentence answers it.
  if (public.screen_first_message(btrim(p_name)) ->> 'action') = 'block' then
    raise exception 'that text breaks our house rules'
      using errcode = 'check_violation', hint = 'guidelines', detail = 'name';
  end if;

  -- NULL is a real answer now: no end date.
  if p_max_stay_until is not null and p_max_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;
  -- The ceiling that used to be a table constraint, said in words.
  if p_max_stay_until is not null and p_max_stay_until > current_date + 400 then
    raise exception 'That is further out than a chat can be set. Pick a nearer day, or choose no end date.'
      using errcode = 'check_violation';
  end if;

  -- Anyone can make a group; nobody can make forty. Serialised per person so
  -- two taps cannot both see a stale count.
  perform pg_advisory_xact_lock(hashtext('create_group:' || v_user::text));
  select count(*) into v_recent
    from public.groups
   where created_by = v_user and created_at > now() - interval '24 hours';
  if v_recent >= 5 then
    raise exception 'You have started a few groups today already.'
      using errcode = 'check_violation';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;
  insert into public.groups (chat_id, created_by, name, photo_path, speaking, max_stay_until)
  values (v_chat, v_user, btrim(p_name), p_photo_path, p_speaking, p_max_stay_until);

  -- The creator runs it, and their own membership runs to the group's own
  -- horizon rather than a week from now.
  --
  -- `'infinity'` when there is no end date. room_members.expires_at is NOT
  -- NULL, and `null::date + 7` is NULL, so without this branch every
  -- no-end-date group failed at birth with a 23502 that rolled the whole
  -- creation back — the chats row, the groups row, all of it.
  v_expires := case
    when p_max_stay_until is null then 'infinity'::timestamptz
    else (p_max_stay_until + 7)::timestamptz
  end;

  insert into public.room_members (chat_id, user_id, departure_date, expires_at, role)
  values (v_chat, v_user, p_max_stay_until, v_expires, 'admin');

  return v_chat;
end
$$;



notify pgrst, 'reload schema';

commit;
