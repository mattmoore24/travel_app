-- Phase 1: identity, profiles, photos, social handles, and the minimal chat
-- tables needed to enforce the accepted-chat gate on social handles at the
-- database layer (PRODUCT_BRIEF.md hard rule 4). Chats/message_requests get
-- their full behavior in Phase 2; their RLS write paths stay closed until then.
--
-- Privacy invariants enforced here (tested in supabase/tests/database/):
--   * social_handles readable ONLY by the owner or a user sharing an active
--     accepted chat with the owner.
--   * verified / verification / moderation_status / users.status are not
--     client-writable (column-level REVOKEs on top of RLS).
--   * moderation_events is a server-only audit table, invisible to clients.
--   * shadowbanned users stay visible to themselves, invisible to others.

-- Enums -----------------------------------------------------------------------

create type public.user_status as enum ('active', 'suspended', 'banned', 'shadowbanned');
create type public.gender as enum ('woman', 'man', 'nonbinary', 'unspecified');
create type public.moderation_status as enum ('pending', 'approved', 'rejected');
create type public.social_platform as enum
  ('instagram', 'tiktok', 'snapchat', 'x', 'facebook', 'whatsapp', 'telegram', 'other');
create type public.chat_status as enum ('active', 'closed');

-- Tables ----------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  status public.user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 50),
  -- Age is entered directly (data minimization: we never store a birthdate).
  age int check (age is null or age between 18 and 120),
  home_city text check (home_city is null or char_length(home_city) <= 80),
  home_country text check (home_country is null or char_length(home_country) <= 80),
  languages text[] not null default '{}'
    check (coalesce(array_length(languages, 1), 0) <= 12),
  bio text check (bio is null or char_length(bio) <= 500),
  -- Supports gender-based visibility filtering from day one (brief §2.5);
  -- the filter UI ships later.
  gender public.gender not null default 'unspecified',
  verified boolean not null default false,
  verification jsonb,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  storage_path text not null unique,
  -- 0 = profile picture, 1-6 = gallery.
  position int not null check (position between 0 and 6),
  moderation_status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index profile_photos_user_idx on public.profile_photos (user_id, position);

create table public.social_handles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  platform public.social_platform not null,
  handle text not null check (char_length(handle) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, platform)
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  status public.chat_status not null default 'active',
  created_at timestamptz not null default now()
);

create table public.chat_participants (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create index chat_participants_user_idx on public.chat_participants (user_id);

create table public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid references public.users (id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Helper functions ------------------------------------------------------------
-- SECURITY DEFINER so policies can consult tables the caller can't read
-- directly (and to avoid RLS self-recursion). search_path pinned per Supabase
-- hardening guidance.
--
-- CALLER-SCOPED BY DESIGN: these helpers never take the viewer as a
-- parameter — they bind to auth.uid() internally. PostgREST exposes every
-- executable public function as an RPC endpoint, so a viewer parameter would
-- let any client probe arbitrary user pairs and dump the private
-- who-is-chatting-with-whom graph. With auth.uid() bound inside, a caller can
-- only ever ask about their own relationships.

create function public.has_accepted_chat(owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.chat_participants po
      on po.chat_id = c.id and po.user_id = owner_id
    join public.chat_participants pv
      on pv.chat_id = c.id and pv.user_id = auth.uid()
    where c.status = 'active'
      and owner_id <> auth.uid()
  )
$$;

create function public.is_chat_member(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_participants
    where chat_id = p_chat_id and user_id = auth.uid()
  )
$$;

-- A profile is visible to OTHER users only while its owner is in good
-- standing. Shadowbanned owners keep seeing themselves (that is the point of
-- a shadowban) via the separate owner policies below.
create function public.is_visible_owner(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = p_user_id and status = 'active'
  )
$$;

-- Triggers --------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every auth signup gets an app user row + empty profile.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id) values (new.id);
  insert into public.profiles (user_id) values (new.id);
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Photo moderation STUB (Phase 5 replaces this with the real pipeline:
-- pending -> async classification -> approve/reject). The stub keeps the
-- moderation chokepoint and audit trail in place from day one by
-- auto-approving and logging the decision.
create function public.moderate_photo_stub()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.moderation_status := 'approved';
  insert into public.moderation_events
    (subject_user_id, entity_type, entity_id, action, source, metadata)
  values
    (new.user_id, 'profile_photo', new.id, 'auto_approved', 'stub',
     jsonb_build_object('storage_path', new.storage_path, 'position', new.position));
  return new;
end
$$;

create trigger profile_photos_moderation_stub
  before insert on public.profile_photos
  for each row execute function public.moderate_photo_stub();

-- Cap: at most 7 photos per user (position CHECK alone doesn't prevent
-- duplicates at the same position; ordering ties are resolved client-side).
create function public.enforce_photo_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('photo_limit:' || new.user_id::text));
  if (select count(*) from public.profile_photos where user_id = new.user_id) >= 7 then
    raise exception 'photo limit reached (7 per user)'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger profile_photos_limit
  before insert on public.profile_photos
  for each row execute function public.enforce_photo_limit();

-- Row Level Security ----------------------------------------------------------

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_photos enable row level security;
alter table public.social_handles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
alter table public.moderation_events enable row level security;

-- users: read own row only; all writes are server-side.
create policy users_select_own
  on public.users for select to authenticated
  using (id = auth.uid());

-- profiles
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (user_id = auth.uid());

create policy profiles_select_visible
  on public.profiles for select to authenticated
  using (public.is_visible_owner(user_id));

create policy profiles_update_own
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- profile_photos: owner sees own regardless of moderation; others only see
-- approved photos of visible owners.
create policy profile_photos_select_own
  on public.profile_photos for select to authenticated
  using (user_id = auth.uid());

create policy profile_photos_select_approved
  on public.profile_photos for select to authenticated
  using (moderation_status = 'approved' and public.is_visible_owner(user_id));

create policy profile_photos_insert_own
  on public.profile_photos for insert to authenticated
  with check (user_id = auth.uid());

create policy profile_photos_update_own
  on public.profile_photos for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy profile_photos_delete_own
  on public.profile_photos for delete to authenticated
  using (user_id = auth.uid());

-- social_handles: HARD RULE 4. Owner, or a user sharing an ACTIVE accepted
-- chat with the owner. Nothing else, ever.
create policy social_handles_select_gated
  on public.social_handles for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_accepted_chat(user_id)
  );

create policy social_handles_insert_own
  on public.social_handles for insert to authenticated
  with check (user_id = auth.uid());

create policy social_handles_update_own
  on public.social_handles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy social_handles_delete_own
  on public.social_handles for delete to authenticated
  using (user_id = auth.uid());

-- chats / chat_participants: members read; creation happens server-side on
-- request acceptance (Phase 2).
create policy chats_select_member
  on public.chats for select to authenticated
  using (public.is_chat_member(id));

create policy chat_participants_select_member
  on public.chat_participants for select to authenticated
  using (public.is_chat_member(chat_id));

-- moderation_events: no client policies — server-only audit trail.

-- Privilege hardening ----------------------------------------------------------
-- Supabase's default privileges GRANT ALL to anon/authenticated on new public
-- tables. RLS gates rows; these REVOKEs gate columns and verbs.

-- anon (signed-out) gets nothing at all.
revoke all on public.users, public.profiles, public.profile_photos,
  public.social_handles, public.chats, public.chat_participants,
  public.moderation_events from anon;

-- users: read-only for clients.
revoke insert, update, delete, truncate, references, trigger
  on public.users from authenticated;

-- profiles: no client insert/delete (trigger creates the row); updates cannot
-- touch verification state, and the `verification` evidence jsonb (identity
-- documents/liveness metadata in Phase 5) is never client-READABLE either —
-- only the public `verified` badge is. Clients must select explicit columns.
revoke insert, delete, truncate, references, trigger
  on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, age, home_city, home_country, languages, bio,
              gender, onboarding_completed_at)
  on public.profiles to authenticated;
revoke select on public.profiles from authenticated;
grant select (user_id, display_name, age, home_city, home_country, languages,
              bio, gender, verified, onboarding_completed_at, created_at,
              updated_at)
  on public.profiles to authenticated;

-- profile_photos: moderation_status is server-owned; clients may only move
-- positions.
revoke update on public.profile_photos from authenticated;
grant update (position) on public.profile_photos to authenticated;
revoke truncate, references, trigger on public.profile_photos from authenticated;

revoke truncate, references, trigger on public.social_handles from authenticated;

-- chats: read-only for clients until Phase 2 server paths exist.
revoke insert, update, delete, truncate, references, trigger
  on public.chats from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.chat_participants from authenticated;

-- moderation_events: fully server-only.
revoke all on public.moderation_events from authenticated;

-- Lock down function execution. Two things matter here:
--   1. Revokes must include PUBLIC — Postgres grants EXECUTE to PUBLIC by
--      default, so revoking only named roles is a no-op.
--   2. The policy helpers stay executable by `authenticated` because RLS
--      policies run them as the invoking role — but they are caller-scoped
--      (auth.uid() bound internally), so direct RPC calls can only ask about
--      the caller's own relationships. anon gets nothing.
revoke execute on function
  public.has_accepted_chat(uuid),
  public.is_chat_member(uuid),
  public.is_visible_owner(uuid)
from public, anon;

revoke execute on function
  public.handle_new_user(),
  public.moderate_photo_stub(),
  public.enforce_photo_limit(),
  public.set_updated_at()
from public, anon, authenticated;
