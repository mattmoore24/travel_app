-- Business accounts, part 2: what a place actually shows
-- ===========================================================================
--
-- docs/BUSINESS_ACCOUNTS.md phase 14. Photos, links, hours, posts, and the
-- two read paths a traveler uses: the markers on the map and one place's
-- full page.
--
-- Everything here hangs off `is_visible_business`, which is the single
-- predicate for "may a stranger see this at all". Writing it once and reusing
-- it is the same discipline `is_visible_owner` already enforces for people:
-- when a listing goes dark, its photos, its links, its hours and its posts go
-- dark with it, rather than each table having its own opinion about it.

-- ---------------------------------------------------------------------------
-- The visibility predicate
-- ---------------------------------------------------------------------------

create function public.is_visible_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses
    where id = p_business_id and active and state = 'listed'
  )
$$;

comment on function public.is_visible_business(uuid) is
  'May a stranger see this business at all. Every content table below reads '
  'it, so a listing that goes dark takes its photos, links, hours and posts '
  'with it rather than leaving them behind.';

-- Owning it, for the write policies. Kept separate from the visibility
-- question on purpose: an owner edits a listing that is still dark.
create function public.owns_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses
    where id = p_business_id and owner_user_id = auth.uid()
  )
$$;

revoke execute on function public.owns_business(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------
--
-- Deliberately its own table rather than reusing profile_photos, which is
-- entangled with avatar semantics and is read by half a dozen matching
-- functions. A business photo is a picture of a room or a plate of food; a
-- profile photo is a picture of a person, and the two are moderated against
-- different questions.

create table public.business_photos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  storage_path text not null unique,
  -- 0 is the cover, the one that appears on the sheet and in the chat list.
  position int not null check (position between 0 and 9),
  moderation_status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index business_photos_idx on public.business_photos (business_id, position);

alter table public.business_photos enable row level security;
revoke all on public.business_photos from anon, authenticated;
grant select (id, business_id, storage_path, position, moderation_status, created_at)
  on public.business_photos to anon, authenticated;
grant insert (business_id, storage_path, position), delete, update (position)
  on public.business_photos to authenticated;

create policy business_photos_select_visible
  on public.business_photos for select to anon, authenticated
  using (moderation_status = 'approved' and public.is_visible_business(business_id));

create policy business_photos_select_own
  on public.business_photos for select to authenticated
  using (public.owns_business(business_id));

create policy business_photos_write_own
  on public.business_photos for all to authenticated
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

insert into storage.buckets (id, name, public)
values ('business-photos', 'business-photos', false)
on conflict (id) do nothing;

-- Path convention `<owner_user_id>/<random>.jpg`, so the first segment is the
-- caller's uid and the proven write policies transfer unchanged. Putting the
-- business id first would have been prettier and would have broken
-- own_object_count(), whose ceiling keys off exactly that segment.
create function public.can_view_business_photo(object_name text)
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
  )
$$;

revoke execute on function public.can_view_business_photo(text) from public, anon;

create policy business_photos_storage_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Storage resolves the object row before deleting, so a DELETE policy with no
-- matching SELECT is a silent no-op that returns success having removed
-- nothing. That cost this project a real bug on the selfie bucket; the SELECT
-- policy below is what makes the owner's own cleanup actually delete.
create policy business_photos_storage_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'business-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or public.can_view_business_photo(name)
    )
  );

create policy business_photos_storage_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Links
-- ---------------------------------------------------------------------------

create type public.business_link_kind as enum (
  'website', 'reservations', 'tickets', 'menu', 'phone', 'email',
  'whatsapp', 'instagram', 'tiktok', 'facebook', 'x', 'other'
);

create table public.business_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind public.business_link_kind not null,
  -- What the button says. "Book a table", never a raw URL.
  label text not null check (char_length(label) between 1 and 40),
  value text not null check (char_length(value) between 1 and 300),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index business_links_idx on public.business_links (business_id, position);

alter table public.business_links enable row level security;
revoke all on public.business_links from anon, authenticated;
grant select on public.business_links to anon, authenticated;
grant insert, update, delete on public.business_links to authenticated;

create policy business_links_select_visible
  on public.business_links for select to anon, authenticated
  using (public.is_visible_business(business_id));

create policy business_links_select_own
  on public.business_links for select to authenticated
  using (public.owns_business(business_id));

create policy business_links_write_own
  on public.business_links for all to authenticated
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

/**
 * Every outbound link in the app passes through here.
 *
 * A business's free-text fields refuse URLs (they go through the same screener
 * a bio does), so this is the single chokepoint where a link can enter, which
 * is exactly why the scheme allowlist lives here rather than in the client. A
 * `javascript:` href in a label somebody taps is the whole reason.
 */
create function public.validate_business_link()
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
    raise exception 'that text breaks our community guidelines'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger business_links_validate
  before insert or update on public.business_links
  for each row execute function public.validate_business_link();

revoke execute on function public.validate_business_link() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hours
-- ---------------------------------------------------------------------------
--
-- Rows, not a 7x2 grid: two rows for one weekday is a split shift, and
-- `closes < opens` is a night that runs past midnight, which is most bars.
-- A weekday with no row is closed. Everything a rule cannot say goes in
-- businesses.hours_note.

create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  opens time not null,
  closes time not null,
  position int not null default 0
);

create index business_hours_idx on public.business_hours (business_id, weekday, position);

alter table public.business_hours enable row level security;
revoke all on public.business_hours from anon, authenticated;
grant select on public.business_hours to anon, authenticated;
grant insert, update, delete on public.business_hours to authenticated;

create policy business_hours_select_visible
  on public.business_hours for select to anon, authenticated
  using (public.is_visible_business(business_id));

create policy business_hours_select_own
  on public.business_hours for select to authenticated
  using (public.owns_business(business_id));

create policy business_hours_write_own
  on public.business_hours for all to authenticated
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------
--
-- **[founder]** "Businesses can choose how long each post is active until it
-- expires, or choose to keep it up indefinitely." So there is no mandatory
-- ceiling. Three shapes:
--
--   a dated event   happens_at set     archives itself the morning after
--   an end date     ends_at set        archives itself then
--   indefinite      both null          stays until it is taken down
--
-- What bounds the surface instead of a ceiling is the live-post cap, and an
-- unverified business gets a smaller one - a quiet incentive to finish the
-- storefront check without withholding anything core.

create table public.business_posts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  body text check (char_length(body) <= 600),
  photo_path text,
  /** When the thing happens, for an event. Null for a standing notice. */
  happens_at timestamptz,
  /** When the post comes down, chosen by the business. Null means never. */
  ends_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_posts_live_idx on public.business_posts (business_id, created_at desc)
  where archived_at is null;

alter table public.business_posts enable row level security;
revoke all on public.business_posts from anon, authenticated;
grant select on public.business_posts to anon, authenticated;
grant insert, update, delete on public.business_posts to authenticated;

create policy business_posts_select_visible
  on public.business_posts for select to anon, authenticated
  using (archived_at is null and public.is_visible_business(business_id));

create policy business_posts_select_own
  on public.business_posts for select to authenticated
  using (public.owns_business(business_id));

create policy business_posts_write_own
  on public.business_posts for all to authenticated
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

create function public.screen_business_post()
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
    raise exception 'that text breaks our community guidelines'
      using errcode = 'check_violation';
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

create trigger business_posts_screen
  before insert or update on public.business_posts
  for each row execute function public.screen_business_post();

revoke execute on function public.screen_business_post() from public, anon, authenticated;

/**
 * Take down what has run its course.
 *
 * A dated event archives the morning after it happened, because "tonight" is
 * the whole value of the post and an event last Tuesday still reading as ON
 * is worse than no post at all. An end date archives when it says. A post
 * with neither stays up, which is the founder's decision and the reason there
 * is no ceiling here.
 */
create function public.archive_expired_posts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.business_posts
     set archived_at = now()
   where archived_at is null
     and (
       (ends_at is not null and ends_at <= now())
       or (ends_at is null and happens_at is not null and happens_at < now() - interval '12 hours')
     );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function public.archive_expired_posts() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The two read paths
-- ---------------------------------------------------------------------------

/**
 * Every place on the map in one city.
 *
 * A third marker family, quieter than traveler pins and drawn beneath them:
 * people stack on top of places, which is the right sentence for this app.
 * `has_live_post` is what earns a brighter ring, so a bar with something on
 * tonight reads differently without being bigger.
 */
create function public.city_businesses(p_city_id int)
returns table (
  id uuid,
  chat_id uuid,
  name text,
  category public.business_category,
  lat double precision,
  lng double precision,
  verified boolean,
  cover_path text,
  has_live_post boolean,
  member_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.chat_id,
    b.name,
    b.category,
    b.lat,
    b.lng,
    b.verified,
    (select bp.storage_path from public.business_photos bp
      where bp.business_id = b.id and bp.moderation_status = 'approved'
      order by bp.position limit 1),
    exists (
      select 1 from public.business_posts po
      where po.business_id = b.id and po.archived_at is null
    ),
    (select count(*)::int from public.room_members rm
      where rm.chat_id = b.chat_id and rm.expires_at > now())
  from public.businesses b
  where b.city_id = p_city_id and b.active and b.state = 'listed'
  order by b.name
$$;

grant execute on function public.city_businesses(int) to anon, authenticated;

/**
 * One place's page.
 *
 * A single call rather than four, because the sheet opens on a tap and four
 * round trips is four chances to render half a place. The hours, links and
 * posts come back as JSON arrays; the client is going to render them as
 * lists anyway, and this keeps one visibility decision instead of four.
 */
create function public.business_detail(p_business_id uuid)
returns table (
  id uuid,
  chat_id uuid,
  city_id int,
  name text,
  category public.business_category,
  description text,
  place_label text,
  hours_note text,
  website_url text,
  lat double precision,
  lng double precision,
  verified boolean,
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
    b.hours_note,
    b.website_url,
    b.lat,
    b.lng,
    b.verified,
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
                                          'photo_path', po.photo_path,
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
  'One place, everything its page shows, in one round trip. Visible to '
  'anybody when the listing is live, and to its owner while it is still '
  'dark, which is the preview the "See it as a traveler" button uses.';
