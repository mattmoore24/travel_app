-- Guests can chat
-- ===========================================================================
--
-- Founder, 2026-08-23: somebody handed a link in a lobby should be able to
-- read the room and answer it. Making an account first is the wrong ask at
-- that moment.
--
-- The mechanism is Supabase anonymous sign-in, and the reason it is the right
-- one is the conversion. An anonymous sign-in creates a REAL auth.users row
-- with a normal session. When that person later adds an email, GoTrue clears
-- is_anonymous on the SAME row - the id never changes - so every chat,
-- membership and message they already have follows them without a migration.
-- The alternative, a second identity table for guests, would need a parallel
-- permission system and a hand-written data move on conversion. This needs
-- neither.
--
-- Everything downstream therefore already works: a guest is `authenticated`,
-- so RLS, chat participation and message authorship need no new paths. The
-- work in this file is almost entirely the other direction - what a guest
-- must NOT be able to do - plus the janitor that clears them out.
--
-- The shape of a guest:
--
--   CAN   read a venue room, join a group they hold a link for, post text
--         in a chat they belong to, set and change their own name.
--   CANNOT be discovered (no map pin, no Travelers card, no featured slot),
--         post trips, drop pins, say hi to a stranger, get verified, choose
--         a visibility audience, or send photos.
--
-- The line is not arbitrary. Everything on the CANNOT side either puts a
-- stranger in front of other people or costs storage and moderation, and an
-- anonymous identity is free to mint. Everything on the CAN side happens
-- inside a room somebody was already invited into.

-- Nothing in this file touches auth.users, and that is the whole lesson from
-- the first attempt. It opened with `alter table auth.users add column
-- is_anonymous` for local-shim parity, which the hosted project refuses
-- outright: the migration role does not own that schema. It passed the pgTAP
-- run because the throwaway cluster has one owner for everything. The column
-- now lives in supabase/shim/, which never runs against production, and real
-- Supabase has had it since anonymous sign-in shipped.
--
-- The same reasoning killed the stored mirror that came with it. There was a
-- public.users.is_guest column kept in step by two triggers on auth.users -
-- one at creation, one at conversion - and every one of those was a thing
-- that could be refused or drift. Reading auth.users.is_anonymous directly
-- from a SECURITY DEFINER function needs none of them: SELECT on auth.users
-- from a definer function is already proven here (see the support inbox
-- resolving addresses in 20260821150000), conversion becomes instant because
-- there is no copy to update, and there is no second source of truth to go
-- stale. It costs one indexed primary-key lookup per guarded write.

create function public.is_guest_account(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.is_anonymous from auth.users u where u.id = p_user_id),
    false)
$$;

revoke execute on function public.is_guest_account(uuid) from public, anon;


-- What a guest must never become ----------------------------------------------

-- A profile with no onboarding stamp is invisible to every discovery surface
-- (is_discoverable_owner and featured_traveler both require it). That is the
-- single load-bearing fact keeping guests off the map and out of Travelers,
-- and onboarding_completed_at happens to be in the client's UPDATE grant -
-- so without this a guest could type a name and make themselves browsable.
create function public.guest_profile_stays_minimal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_guest_account(new.user_id) then
    return new;
  end if;
  if new.onboarding_completed_at is not null then
    raise exception 'a guest is not a profile: make an account to be discoverable'
      using errcode = 'check_violation';
  end if;
  -- Age and gender feed the visibility audiences and the card. A guest has a
  -- name and nothing else, so there is nothing to leak and nothing to filter
  -- them by.
  if new.age is not null or new.gender <> 'unspecified' or new.bio is not null then
    raise exception 'a guest has a name, nothing more'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger profiles_guest_minimal
  before update on public.profiles
  for each row execute function public.guest_profile_stays_minimal();

-- Trips and pins are the two things that put you in front of strangers.
create function public.guests_do_not_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_guest_account(new.user_id) then
    raise exception 'make an account to post %', tg_argv[0]
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger trips_no_guests
  before insert on public.trips
  for each row execute function public.guests_do_not_broadcast('trips');

create trigger pins_no_guests
  before insert on public.pins
  for each row execute function public.guests_do_not_broadcast('pins');


-- Three more doors a guest does not get, each guarded at the TABLE rather
-- than in the RPC above it: a trigger cannot be routed around by a path
-- somebody adds later, and every one of these tables already has more than
-- one way in.

create function public.guests_do_not_reach_strangers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_guest_account(new.sender_id) then
    raise exception 'make an account to message someone new'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- Saying hi to a stranger is the one chat action that is not "answer the room
-- you were invited to". It puts an unaccountable identity in front of
-- somebody who never asked for it, so it stays behind an account.
create trigger message_requests_no_guests
  before insert on public.message_requests
  for each row execute function public.guests_do_not_reach_strangers();

create function public.guests_do_not_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_guest_account(new.user_id) then
    raise exception 'make an account first' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- Photos cost storage and a vision call apiece, and a guest has no profile
-- for one to appear on. Verification is the same argument twice over: there
-- is nothing to check a selfie against, and a badge is a claim about a
-- person who has not made an account.
create trigger profile_photos_no_guests
  before insert on public.profile_photos
  for each row execute function public.guests_do_not_upload();

create trigger verification_requests_no_guests
  before insert on public.verification_requests
  for each row execute function public.guests_do_not_upload();


-- Abuse: an anonymous identity is free to mint -------------------------------
--
-- Three separate ceilings, because they fail differently. The membership cap
-- stops one guest papering every room in a city; the daily message cap sits
-- under the existing 30-a-minute throttle and catches the slow flood it lets
-- through; the photo block keeps a free identity away from storage and the
-- vision classifier entirely.

create function public.guest_membership_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_guest_account(new.user_id) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('guest_rooms:' || new.user_id::text));
  if (select count(*) from public.room_members
      where user_id = new.user_id
        and expires_at > now()
        and chat_id <> new.chat_id) >= 10 then
    raise exception 'a guest can be in 10 chats at once. Make an account for more'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger room_members_guest_cap
  before insert on public.room_members
  for each row execute function public.guest_membership_cap();

create function public.guest_message_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_guest_account(new.sender_id) then
    return new;
  end if;
  if new.image_path is not null then
    raise exception 'make an account to send photos' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.messages
      where sender_id = new.sender_id
        and created_at > now() - interval '24 hours') >= 200 then
    raise exception 'daily limit reached. Make an account to keep going'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger messages_guest_limits
  before insert on public.messages
  for each row execute function public.guest_message_limits();


-- Naming yourself, and changing your mind -------------------------------------
--
-- The only profile write a guest makes. Its own RPC rather than a column
-- grant so the guest rules live in one readable place, and so the screening
-- the profiles trigger already applies to a display name still runs.

create function public.set_guest_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_guest_account(v_user) then
    raise exception 'this is for guests; a member edits their profile'
      using errcode = 'check_violation';
  end if;
  if v_name is null or char_length(v_name) > 50 then
    raise exception 'pick a name between 1 and 50 characters'
      using errcode = 'check_violation';
  end if;
  -- Straight through the profiles trigger, so a guest name is screened and
  -- rate-limited exactly like anybody else's.
  update public.profiles set display_name = v_name where user_id = v_user;
  return v_name;
end
$$;

revoke execute on function public.set_guest_name(text) from public, anon;
grant execute on function public.set_guest_name(text) to authenticated;


-- The janitor ------------------------------------------------------------------
--
-- Guests are free to mint, so they have to be free to remove, or the table
-- only grows.
--
-- Split in two on purpose. This half only NAMES them; the deleting is done by
-- the guest-janitor Edge Function through the admin API, exactly as
-- delete-account already does it. The first version of this file ran
-- `delete from auth.users` straight out of a pg_cron job, which is the same
-- mistake as the ALTER above wearing different clothes: it may or may not be
-- permitted, and it would have failed at four in the morning inside a cron
-- job where nobody was looking. Every other privileged thing in this project
-- goes through a worker, and so does this.
--
-- Deleting a guest takes their messages with them, and that is the point.
-- Data minimisation says an abandoned throwaway identity should not be kept
-- indefinitely, and 30 days past their last word, with no live membership
-- left, is well past the point where anyone is still reading the thread. A
-- member who wants their words to persist has the account that makes that
-- true.

create function public.stale_guest_ids(p_limit int default 200)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.users u
  join auth.users a on a.id = u.id
  where a.is_anonymous
    and u.created_at < now() - interval '30 days'
    and not exists (
      select 1 from public.room_members rm
      where rm.user_id = u.id and rm.expires_at > now()
    )
    and not exists (
      select 1 from public.messages m
      where m.sender_id = u.id and m.created_at > now() - interval '30 days'
    )
  order by u.created_at
  limit p_limit
$$;

revoke execute on function public.stale_guest_ids(int) from public, anon, authenticated;

comment on function public.stale_guest_ids(int) is
  'Anonymous accounts idle for 30 days with no live membership. Named here, '
  'deleted by the guest-janitor worker through the admin API - the same door '
  'delete-account uses, because SQL cannot be trusted to delete an auth row.';

-- Same guard the other workers use: pg_cron only exists on a real deployment,
-- so a keyless dev box and the pgTAP cluster skip scheduling without failing
-- the migration.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'guest-janitor',
      '30 4 * * *',
      $cron$select public.invoke_edge_worker('guest-janitor')$cron$
    );
  end if;
end
$$;
