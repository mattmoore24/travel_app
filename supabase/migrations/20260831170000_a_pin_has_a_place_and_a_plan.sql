-- A pin has a place and a plan
-- =============================================================================
--
-- One column was being asked to be two things. The field labelled "What's the
-- plan?" wrote venue_name: when the place came from search it arrived
-- pre-filled with 'Time Out Market', which is not a plan; when it came from a
-- drag it held free text, which is not a venue. Three strings broke
-- downstream. The opening message composed as "Hey! What time are you heading
-- to Rooftop hello?". clusterTitle fell back to '2 plans here' whenever two
-- people at one bar wrote different plan text, and the venue sheet then
-- printed that string twice. And the marker's VoiceOver label opened with a
-- sentence rather than a place. The app could not answer "which bar is this"
-- about its own pins.
--
-- So pins.plan carries what the person is DOING, and venue_name goes back to
-- naming the spot. NO BACKFILL, deliberately: which existing rows hold plan
-- text is a guess (the package's own risk note), pins live at most 72 hours,
-- and doing nothing is simply correct within three days.

alter table public.pins
  add column plan text check (plan is null or char_length(plan) between 1 and 80);

comment on column public.pins.plan is
  'What the person is doing there, in their own words ("Sunset drinks").
The venue_name is the spot; this is the plan. Both are shown, neither is
identity, and curated pins carry seed_note instead.';

-- INSERT on pins is granted per COLUMN (20260828150000: created_at belongs
-- to the server), so the new column must join the list or the app''s insert
-- dies with permission denied while the read half looks fine. SELECT stays a
-- table-level grant, so `select *` keeps working (test 31 pins that).
grant insert (plan) on public.pins to authenticated;

-- ---------------------------------------------------------------------------
-- post_joinable_pin grows p_plan
-- ---------------------------------------------------------------------------
--
-- DROP FIRST here too, for a different reason than the OUT-column rule:
-- create-or-replace with an extra parameter CREATES AN OVERLOAD, and two
-- candidates make PostgREST refuse every call as ambiguous. Grants go with
-- the drop and are restated. p_plan sits last WITH A DEFAULT so a client
-- still running the previous over-the-air bundle keeps posting.
--
-- Body restated from the LIVE version (20260829190000, which added the
-- business refusal) with two changes: the insert carries plan, and the
-- group is named from the PLAN first — "the group is called what the plan
-- is called" was written when the plan text lived in venue_name, and it
-- moves with it. The venue stays the fallback.

drop function if exists public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date, timestamptz
);

create function public.post_joinable_pin(
  p_city_id int,
  p_venue_name text,
  p_note text,
  p_place_label text,
  p_category public.pin_category,
  p_lat double precision,
  p_lng double precision,
  p_intent_date date,
  p_expires_at timestamptz,
  p_plan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pin uuid;
  v_chat uuid;
  v_recent int;
  v_name text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  perform public.assert_not_business('post a plan');

  perform pg_advisory_xact_lock(hashtext('joinable_pin:' || v_user::text));
  select count(*) into v_recent
    from public.groups
   where created_by = v_user
     and pin_id is not null
     and created_at > now() - interval '24 hours';
  if v_recent >= 5 then
    raise exception 'You have opened a few plans to join today already. Post this one as message-me-first, or try again tomorrow.'
      using errcode = 'check_violation';
  end if;

  insert into public.pins (
    user_id, city_id, venue_name, note, place_label, plan,
    category, lat, lng, intent_date, expires_at, seeded
  )
  values (
    v_user, p_city_id, btrim(p_venue_name), p_note, p_place_label,
    nullif(btrim(coalesce(p_plan, '')), ''),
    p_category, p_lat, p_lng, p_intent_date, p_expires_at, false
  )
  returning id into v_pin;

  -- The group is called what the plan is called — the plan text first, the
  -- venue as fallback. groups.name allows 2 to 60 characters and both
  -- sources allow 1 to 80, so both ends need saying: a long name is cut,
  -- and a one-character one — which would fail the CHECK and roll the pin
  -- back with it — gets a name instead.
  v_name := left(btrim(coalesce(nullif(btrim(coalesce(p_plan, '')), ''), p_venue_name)), 60);
  if char_length(v_name) < 2 then
    v_name := 'Meet up';
  end if;

  insert into public.chats (kind) values ('room') returning id into v_chat;

  -- No end date, deliberately. The pin's 72 hours are the pin's; the
  -- conversation that came out of it is not on a timer.
  insert into public.groups (chat_id, created_by, name, speaking, max_stay_until, pin_id)
  values (v_chat, v_user, v_name, 'everyone', null, v_pin);

  -- 'infinity' rather than a date, for the same reason create_group does it:
  -- room_members.expires_at is NOT NULL and `null::date + 7` is null, which
  -- would fail at 23502 and take the whole pin down with it.
  insert into public.room_members (chat_id, user_id, departure_date, expires_at, role)
  values (v_chat, v_user, null, 'infinity', 'admin');

  return jsonb_build_object('pin_id', v_pin, 'chat_id', v_chat);
end
$$;

revoke execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text
) from public, anon;
grant execute on function public.post_joinable_pin(
  int, text, text, text, public.pin_category, double precision, double precision, date,
  timestamptz, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- The two map feeds return the plan
-- ---------------------------------------------------------------------------
--
-- DROP FIRST, both of them (AGENTS.md, verbatim): Postgres refuses to add an
-- OUT column to an existing RETURNS TABLE through create or replace, and the
-- deploy would die AFTER the alter table above had already applied, leaving
-- a column no function returns. Grants go with the drops and are restated.
--
-- Bodies are the LIVE ones with only `plan` added: city_pins from
-- 20260830000000 (the viewer_is_business refusal is load-bearing),
-- public_city_pins from 20260829120000.

drop function if exists public.city_pins(int);

create function public.city_pins(p_city_id int)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  age int,
  verified boolean,
  photo_path text,
  venue_name text,
  note text,
  plan text,
  place_label text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  seeded boolean,
  seed_note text,
  expires_at timestamptz,
  chat_id uuid,
  crew int
)
language sql
stable
as $$
  select
    p.id,
    p.user_id,
    pr.display_name,
    pr.age,
    pr.verified,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = p.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    p.venue_name,
    p.note,
    p.plan,
    p.place_label,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.seeded,
    p.seed_note,
    p.expires_at,
    public.pin_chat(p.id),
    public.pin_chat_size(p.id)
  from public.pins p
  left join public.profiles pr on pr.user_id = p.user_id
  where p.city_id = p_city_id
    and not public.viewer_is_business()
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
  order by p.intent_date, p.created_at
$$;

revoke execute on function public.city_pins(int) from public, anon;
grant execute on function public.city_pins(int) to authenticated;

comment on function public.city_pins(int) is
  'Every open plan in a city, with the face behind each one. Empty for a '
  'business account: the business map shows businesses, and this is the '
  'traveler feed the founder said it is not for. Now carries plan beside '
  'venue_name: the spot and what is happening there are two columns.';

drop function if exists public.public_city_pins(int);

create function public.public_city_pins(p_city_id int)
returns table (
  id uuid,
  venue_name text,
  note text,
  plan text,
  place_label text,
  category public.pin_category,
  lat double precision,
  lng double precision,
  intent_date date,
  seeded boolean,
  seed_note text,
  expires_at timestamptz,
  chat_id uuid,
  crew int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.venue_name,
    p.note,
    p.plan,
    p.place_label,
    p.category,
    p.lat,
    p.lng,
    p.intent_date,
    p.seeded,
    case when p.seeded then p.seed_note else null end,
    p.expires_at,
    public.pin_chat(p.id),
    public.pin_chat_size(p.id)
  from public.pins p
  join public.launch_cities lc on lc.city_id = p.city_id and lc.active
  where p.city_id = p_city_id
    and p.expires_at > now()
    and (
      p.seeded
      or (
        public.is_discoverable_owner(p.user_id)
        and public.discovery_pair_ok(auth.uid(), p.user_id)
      )
    )
  order by p.intent_date, p.created_at
$$;

revoke execute on function public.public_city_pins(int) from public;
grant execute on function public.public_city_pins(int) to anon, authenticated;

comment on function public.public_city_pins(int) is
  'Pins with no person attached, for guests. Honours the owner''s audience: '
  'somebody who narrowed to verified is not on a signed-out visitor''s map '
  'either. Says whether a pin is open to join and how many are in, and now '
  'carries plan beside venue_name.';

notify pgrst, 'reload schema';
