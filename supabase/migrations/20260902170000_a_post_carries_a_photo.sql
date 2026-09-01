-- A post can carry a photo, and the photo is checked before anybody sees it.
--
-- `business_posts.photo_path` has existed since 20260827110000:316 and
-- `business_detail` has always returned it, so place/[id].tsx:116-118 has
-- always been ready to draw one. Nothing ever wrote it: a grep for `photo`
-- across the composer returned nothing. A bar posting "Live music, no cover"
-- could not show the band.
--
-- THE HALF THAT IS NOT OPTIONAL. `business_posts` had no moderation column of
-- any kind, so a picker on its own would put an unreviewed image on a page
-- granted to `anon` while BUSINESS_RULE_SECTIONS promises photos are checked.
-- Two things follow, and the second is the one that is easy to get wrong:
--
--   * moderation attaches to the ROW a photo creates, never to the bucket.
--     Sharing `business-photos` with the photo grid buys a post photo nothing,
--     because `moderate_business_photo_stub` is a trigger on
--     `business_photos` and a post photo makes no row there.
--   * so does READABILITY. `can_view_business_photo` resolves an object name
--     through `business_photos`, and a post photo has no row to resolve
--     through, so every traveler signing that URL got a refusal. The function
--     is widened below, on the same terms: approved and on a visible listing,
--     or your own.
--
-- Mirrors 20260829180000 exactly, both branches: flag OFF approves on insert
-- so keyless dev and a flag-off project keep working, flag ON holds at
-- 'pending' and queues an event for the worker. Production runs with the flag
-- ON (LAUNCH_RUNBOOK step 1).
--
-- The last statement is unrelated to the photo and is here because it has
-- nowhere else to go this session: `city_whats_on`, which is what lets the
-- map's plan list say WHAT is on at a business rather than only that
-- something is. It is a new function, so it drops nothing and reverts nothing.

-- ---------------------------------------------------------------------------
-- The column, and the state it starts in
-- ---------------------------------------------------------------------------

-- `grant select on public.business_posts` is table-wide (20260827110000:331),
-- not column-listed, so a new column cannot break the app's star reads the way
-- one did on business_photos. Nothing to re-grant.
alter table public.business_posts
  add column if not exists photo_status public.moderation_status not null default 'pending';

alter table public.business_posts
  add column if not exists moderation_attempts int not null default 0;

-- Every row that exists today has no photo, and 'pending' would read as "a
-- photo of this is being checked" about a post that has none.
update public.business_posts set photo_status = 'approved' where photo_path is null;

-- The storage read below asks "is this object name a live post photo", which
-- is a lookup by path and not by business.
create index if not exists business_posts_photo_path_idx
  on public.business_posts (photo_path)
  where photo_path is not null;

comment on column public.business_posts.photo_status is
  'Server-owned. The trigger below sets it on insert and on every change of '
  'photo_path, and pins it to its old value otherwise, so a client holding '
  'table-wide UPDATE cannot approve its own picture.';

-- ---------------------------------------------------------------------------
-- The check
-- ---------------------------------------------------------------------------

create or replace function public.moderate_business_post_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  -- Written as nested branches rather than one `and`, for the reason
  -- screen_business_post records beside it: OLD is an unassigned record on
  -- INSERT, SQL does not promise to short-circuit, and reading it raises.
  if tg_op = 'UPDATE' then
    if new.photo_path is not distinct from old.photo_path then
      -- Nothing about the photo changed, so neither may its verdict. This is
      -- the guard on the write grant: `grant insert, update, delete on
      -- public.business_posts to authenticated` is table-wide, so without it
      -- an owner fixing a typo could send `photo_status = 'approved'` along
      -- with the title.
      --
      -- Only a CLIENT is held, and that distinction is the whole reason this
      -- is not an unconditional pin: `apply_business_post_photo_verdict`
      -- lands the worker's answer with exactly this shape — an UPDATE that
      -- moves photo_status and touches nothing else — so pinning everybody
      -- would quietly swallow every verdict and leave every photo pending
      -- forever. Same test `assert_service_caller` makes, from the other end.
      if auth.role() in ('anon', 'authenticated') then
        new.photo_status := old.photo_status;
        new.moderation_attempts := old.moderation_attempts;
      end if;
      return new;
    end if;
  end if;

  if new.photo_path is null then
    -- No photo is not a photo awaiting a verdict. Said as 'approved' because
    -- every reader asks `photo_path is not null and photo_status = 'approved'`
    -- and a permanent 'pending' on an empty post would be a lie in the ledger.
    new.photo_status := 'approved';
    new.moderation_attempts := 0;
    return new;
  end if;

  new.moderation_attempts := 0;

  -- The subject is whoever runs the place. Nullable, so read it rather than
  -- assume: an unclaimed launch venue has no owner and an event about nobody
  -- is still worth recording.
  select owner_user_id into v_owner
  from public.businesses
  where id = new.business_id;

  if public.config_flag('require_photo_moderation') then
    new.photo_status := 'pending';
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_owner, 'business_post_photo', new.id, 'queued_for_llm', 'photo-pipeline',
       jsonb_build_object('storage_path', new.photo_path,
                          'business_id', new.business_id));
  else
    new.photo_status := 'approved';
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_owner, 'business_post_photo', new.id, 'auto_approved', 'stub',
       jsonb_build_object('storage_path', new.photo_path,
                          'business_id', new.business_id));
  end if;
  return new;
end
$$;

-- Fires before `business_posts_screen`, which is alphabetical order and is
-- also the order that matters least: both are BEFORE triggers, both only
-- amend NEW, and neither reads what the other writes.
drop trigger if exists business_posts_moderate_photo on public.business_posts;
create trigger business_posts_moderate_photo
  before insert or update on public.business_posts
  for each row execute function public.moderate_business_post_photo();

revoke execute on function public.moderate_business_post_photo()
  from public, anon, authenticated;

-- The worker's door, the twin of apply_business_photo_verdict
-- (20260829180000:82). No push on either branch, for the reason recorded
-- there: a business account is not a traveler, has no strike ledger, and a
-- notification reading "Photo removed" on an account with no profile is a
-- message from nowhere. The event is the record.
create or replace function public.apply_business_post_photo_verdict(
  p_post_id uuid,
  p_verdict jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.business_posts%rowtype;
  v_owner uuid;
begin
  perform public.assert_service_caller();
  select * into v_post
  from public.business_posts
  where id = p_post_id and photo_status = 'pending' and photo_path is not null
  for update;
  if not found then
    raise exception 'that post photo is not awaiting moderation';
  end if;

  select owner_user_id into v_owner
  from public.businesses
  where id = v_post.business_id;

  if p_verdict ->> 'action' = 'allow' then
    update public.business_posts
      set photo_status = 'approved' where id = p_post_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_owner, 'business_post_photo', p_post_id, 'photo_approved',
       'claude-moderator', p_verdict);
  else
    update public.business_posts
      set photo_status = 'rejected' where id = p_post_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_owner, 'business_post_photo', p_post_id,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'photo_rejected_failsafe'
            else 'photo_rejected' end,
       case when p_verdict ->> 'engine' = 'failsafe'
            then 'failsafe' else 'claude-moderator' end,
       p_verdict);
  end if;
end
$$;

revoke execute on function public.apply_business_post_photo_verdict(uuid, jsonb)
  from public, anon, authenticated;

-- Count an attempt, so a photo the model keeps refusing cannot spin forever.
create or replace function public.note_business_post_photo_attempt(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_service_caller();
  update public.business_posts
     set moderation_attempts = moderation_attempts + 1
   where id = p_post_id;
end
$$;

revoke execute on function public.note_business_post_photo_attempt(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may read the object
-- ---------------------------------------------------------------------------
--
-- Restated from 20260827110000:103 with a second arm. Without it a post photo
-- is unreadable by everyone but the account that uploaded it, because
-- `business_photos_storage_select_own` falls through to this function for
-- anybody else and this function only knew about the photo grid. The terms are
-- the grid's own, plus `archived_at is null`: a post taken down takes its
-- picture with it, exactly as `business_detail` and `city_businesses` already
-- take its words.
--
-- create or replace keeps the ACL, and the revoke below is restated anyway
-- rather than trusted.
create or replace function public.can_view_business_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_photos bp
    where bp.storage_path = object_name
      and (
        public.owns_business(bp.business_id)
        or (bp.moderation_status = 'approved' and public.is_visible_business(bp.business_id))
      )
  ) or exists (
    select 1
    from public.business_posts po
    where po.photo_path = object_name
      and (
        public.owns_business(po.business_id)
        or (po.photo_status = 'approved'
            and po.archived_at is null
            and public.is_visible_business(po.business_id))
      )
  )
$$;

revoke execute on function public.can_view_business_photo(text) from public, anon;

-- ---------------------------------------------------------------------------
-- What a traveler is handed
-- ---------------------------------------------------------------------------
--
-- Restated from 20260829160000:246, its current definition, with the posts
-- array changed and NOTHING else. The OUT columns do not move — the two new
-- facts ride inside the `posts` jsonb — so create-or-replace is correct here
-- and there is no signature to drop. If a later edit ever adds an OUT column,
-- that one has to drop the function first and restate the grant below.
--
-- `photo_state` is the same vocabulary `room_messages` settled on
-- (20260828180000:33): the state is not a secret, every photo in this app is
-- checked, and saying "being checked" is the honest version of a blank
-- rectangle. The PATH is what stays masked.
--
-- The owner sees their own picture while it is being checked, and after it is
-- refused, for the reason room_messages gives: the storage policy already lets
-- somebody read their own upload by the uid in its first path segment, so
-- withholding the path from them hides nothing and leaves the person who took
-- the photo looking at an empty frame.
create or replace function public.business_detail(p_business_id uuid)
returns table (
  id uuid,
  chat_id uuid,
  city_id int,
  name text,
  category public.business_category,
  description text,
  place_label text,
  address text,
  hours_note text,
  website_url text,
  lat double precision,
  lng double precision,
  verified boolean,
  claimed boolean,
  member_count int,
  photos jsonb,
  links jsonb,
  hours jsonb,
  posts jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.chat_id,
    b.city_id,
    b.name,
    b.category,
    b.description,
    b.place_label,
    b.address,
    b.hours_note,
    b.website_url,
    b.lat,
    b.lng,
    b.verified,
    b.owner_user_id is not null,
    (select count(*)::int from public.room_members rm
      where rm.chat_id = b.chat_id and rm.expires_at > now()),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'storage_path', p.storage_path)
                       order by p.position)
      from public.business_photos p
      where p.business_id = b.id and p.moderation_status = 'approved'
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'label', l.label,
                                          'value', l.value) order by l.position, l.created_at)
      from public.business_links l where l.business_id = b.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', h.opens,
                                          'closes', h.closes) order by h.weekday, h.position)
      from public.business_hours h where h.business_id = b.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', po.id, 'title', po.title, 'body', po.body,
                                          'photo_path',
                                            case
                                              when po.photo_path is null then null
                                              when po.photo_status = 'approved' then po.photo_path
                                              when public.owns_business(b.id) then po.photo_path
                                              else null
                                            end,
                                          'photo_state',
                                            case
                                              when po.photo_path is null then 'none'
                                              when po.photo_status = 'approved' then 'ready'
                                              when po.photo_status = 'rejected' then 'blocked'
                                              else 'checking'
                                            end,
                                          'happens_at', po.happens_at, 'ends_at', po.ends_at)
                       order by po.happens_at nulls last, po.created_at desc)
      from public.business_posts po
      where po.business_id = b.id and po.archived_at is null
    ), '[]'::jsonb)
  from public.businesses b
  where b.id = p_business_id
    and (public.is_visible_business(b.id) or public.owns_business(b.id))
$$;

grant execute on function public.business_detail(uuid) to anon, authenticated;

comment on function public.business_detail(uuid) is
  'One place''s page in a single call. `claimed` says whether anybody runs it '
  'here, so a traveler is not offered Message on a venue where '
  'message_business would refuse them after they had typed. Each post carries '
  '`photo_state`, and its `photo_path` only once that state is ready — or to '
  'the owner, who can read their own upload anyway.';

-- ---------------------------------------------------------------------------
-- What is on, so a post reaches somebody
-- ---------------------------------------------------------------------------
--
-- `city_businesses` returns `has_live_post`, a boolean, so the map can brighten
-- a ring and the plan list can say "Something on tonight". Neither can say what
-- the something IS, which is the whole content a business produces and the
-- reason posting twice is worth a bar's time.
--
-- ONE ROW PER BUSINESS, the soonest post, because the surface reading this is
-- one row per business under the map's plan list. `distinct on` leads the
-- ORDER BY with its own expression, which Postgres requires.
--
-- Businesses only, at venue level, showing only what the map already shows
-- publicly: mixing traveler plans in here would turn a what's-on list into a
-- browsable roster of people, which is a different product and a §7 problem.
--
-- The filters are `city_businesses`'s own, deliberately: a row about a business
-- the map is not showing would be dropped by the caller's merge anyway, and
-- copying the filters means the two lists cannot come to disagree about which
-- listings exist.
create function public.city_whats_on(p_city_id int)
returns table (
  business_id uuid,
  post_id uuid,
  title text,
  happens_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (po.business_id)
    po.business_id,
    po.id,
    po.title,
    po.happens_at
  from public.business_posts po
  join public.businesses b on b.id = po.business_id
  where b.city_id = p_city_id
    and b.active
    and b.state = 'listed'
    and po.archived_at is null
  order by po.business_id, po.happens_at nulls last, po.created_at desc
$$;

grant execute on function public.city_whats_on(int) to anon, authenticated;

comment on function public.city_whats_on(int) is
  'What is on at each listed business in one city: the soonest live post per '
  'business. The twin of city_businesses.has_live_post, carrying the words '
  'instead of the boolean.';
