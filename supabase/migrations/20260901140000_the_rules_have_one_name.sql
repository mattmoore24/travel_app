-- The rulebook has one name in the database too (decision D32).
--
-- The audit filed this as a client copy problem. It is not. src/lib/
-- query-client.ts shows a database message to the user verbatim, and
-- src/lib/failure-message.ts says so on purpose ("a message the DATABASE
-- wrote is already a sentence somebody chose"). Six live functions raise
-- 'that text breaks our community guidelines', and only two screens map it to
-- friendlier words: everywhere else - a business name, a description, a post,
-- a link label, an address - the traveler or the owner reads the Postgres
-- sentence exactly as written. So the fifth name for the rulebook was the one
-- most people were going to see.
--
-- Six create-or-replace. Every body is copied from the LATEST live definition
-- and the only changes in any of them are that string and the hint beside it:
--
--   screen_profile_text    20260831140000_a_failure_says_what_to_do.sql:280
--   screen_prompt_answer   20260822160000_profile_prompts.sql:54
--   screen_priority_text   20260827080000_profile_priorities.sql:57
--   screen_business_text   20260829160000_a_business_says_where_it_is.sql:52
--                          (NOT 20260827100000 or 20260827160000 - three
--                           definitions exist and only the newest is live)
--   validate_business_link 20260827110000_business_content.sql:199
--   screen_business_post   20260827110000_business_content.sql:347
--
-- None returns a table and none changes signature, so the drop-first rule
-- does not bite here. The revokes are restated anyway, which is what this
-- repo does after every replace.
--
-- EVERY ONE OF THE SIX NOW CARRIES hint = 'guidelines'. Five of them did not,
-- and that was the exact failure D3 was written to stop: without a hint the
-- client can only recognise the raise by matching its English prose, so the
-- one file whose whole job is renaming that prose would have left five
-- screens matching a sentence that no longer exists. A hint is a code, and a
-- code survives a rewording. src/lib/failure-message.ts answers 'guidelines'
-- from HINT_COPY, and keeps BOTH spellings of the prose in DB_COPY as the
-- belt underneath - not for these definitions, which now send the code, but
-- for whatever is still deployed until this migration lands.
--
-- Deploy order does not matter for the same reason: an installed build
-- reading the new text, or a new build reading the old, shows the same
-- sentence either way.

-- 1. Profile display name and bio -------------------------------------------

create or replace function public.screen_profile_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verdict jsonb;
begin
  if (select count(*) from public.moderation_events
      where subject_user_id = new.user_id
        and entity_type = 'profile' and action = 'updated'
        and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'daily profile update limit reached'
      using errcode = 'check_violation', hint = 'profile_daily_cap';
  end if;
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source)
  values (new.user_id, 'profile', new.user_id, 'updated', 'rate-limit');

  if new.display_name is distinct from old.display_name
     or new.bio is distinct from old.bio then
    v_verdict := public.screen_first_message(
      coalesce(new.display_name, '') || ' ' || coalesce(new.bio, ''));
    if v_verdict ->> 'action' = 'block' then
      -- No audit row here: the raise aborts this transaction, so an insert
      -- could never persist. The enforcement is the rejection itself — the
      -- text never goes public. (LLM-grade bio review stays a flagged
      -- follow-up in ARCHITECTURE.)
      raise exception 'that text breaks our house rules'
        using errcode = 'check_violation', hint = 'guidelines';
    end if;
  end if;
  return new;
end
$$;

revoke execute on function public.screen_profile_text() from public, anon, authenticated;

-- 2. Profile prompt answers --------------------------------------------------

create or replace function public.screen_prompt_answer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.screen_first_message(new.answer) ->> 'action') = 'block' then
    raise exception 'that text breaks our house rules'
      using errcode = 'check_violation', hint = 'guidelines';
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke execute on function public.screen_prompt_answer() from public, anon, authenticated;

-- 3. Profile priorities ------------------------------------------------------

create or replace function public.screen_priority_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.screen_first_message(new.text) ->> 'action') = 'block' then
    raise exception 'that text breaks our house rules'
      using errcode = 'check_violation', hint = 'guidelines';
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke execute on function public.screen_priority_text() from public, anon, authenticated;

-- 4. A business's own free text ----------------------------------------------

create or replace function public.screen_business_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.screen_first_message(
        concat_ws(' ', new.name, new.description, new.place_label, new.hours_note, new.address)
      ) ->> 'action') = 'block' then
    raise exception 'that text breaks our house rules'
      using errcode = 'check_violation', hint = 'guidelines';
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke execute on function public.screen_business_text() from public, anon, authenticated;

-- 5. A business's link labels ------------------------------------------------

create or replace function public.validate_business_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count from public.business_links
   where business_id = new.business_id and id <> coalesce(new.id, gen_random_uuid());
  if v_count >= 10 then
    raise exception 'ten links is plenty' using errcode = 'check_violation';
  end if;

  if new.kind in ('phone', 'whatsapp') then
    if new.value !~ '^\+?[0-9 ()-]{5,30}$' then
      raise exception 'that does not look like a phone number'
        using errcode = 'check_violation';
    end if;
  elsif new.kind = 'email' then
    if new.value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'that does not look like an email address'
        using errcode = 'check_violation';
    end if;
  elsif new.kind in ('instagram', 'tiktok', 'facebook', 'x') then
    -- A handle or a full URL, both fine; anything with a scheme must be https.
    if new.value ~ ':' and new.value !~* '^https://' then
      raise exception 'links have to start with https://'
        using errcode = 'check_violation';
    end if;
  else
    if new.value !~* '^https://' then
      raise exception 'links have to start with https://'
        using errcode = 'check_violation';
    end if;
    -- An IP literal is never a real business's website and is how a link
    -- gets somewhere the label does not admit to.
    if new.value ~* '^https://[0-9]{1,3}(\.[0-9]{1,3}){3}' then
      raise exception 'that link needs a real domain' using errcode = 'check_violation';
    end if;
  end if;

  if (public.screen_first_message(new.label) ->> 'action') = 'block' then
    raise exception 'that text breaks our house rules'
      using errcode = 'check_violation', hint = 'guidelines';
  end if;

  return new;
end
$$;

revoke execute on function public.validate_business_link() from public, anon, authenticated;

-- 6. A business's posts ------------------------------------------------------

create or replace function public.screen_business_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live int;
  v_cap int;
  v_counts boolean := false;
begin
  if (public.screen_first_message(concat_ws(' ', new.title, new.body)) ->> 'action') = 'block' then
    raise exception 'that text breaks our house rules'
      using errcode = 'check_violation', hint = 'guidelines';
  end if;

  -- Written as two branches rather than one OR, because OLD is an unassigned
  -- record on INSERT and reading OLD.archived_at from it raises. The single
  -- expression happened to work only because the boolean short-circuited,
  -- which is not something to rely on.
  if tg_op = 'INSERT' then
    v_counts := true;
  elsif new.archived_at is null and old.archived_at is not null then
    v_counts := true;
  end if;

  if v_counts then
    select case when b.verified then 10 else 3 end into v_cap
      from public.businesses b where b.id = new.business_id;
    select count(*) into v_live from public.business_posts
     where business_id = new.business_id and archived_at is null and id <> new.id;
    if v_live >= coalesce(v_cap, 3) then
      raise exception 'you have as many posts up as you can have at once'
        using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;

revoke execute on function public.screen_business_post() from public, anon, authenticated;
