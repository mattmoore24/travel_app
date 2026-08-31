-- Being put in a group is visible, and refusable in advance.
--
-- The whole architecture of this app is consent before exposure: first
-- messages are moderated, socials are invisible until an accepted chat, a chat
-- only opens when the other person answers. Group membership was the one place
-- that grammar broke. add_to_group inserts straight into room_members with no
-- notification and no record of who did it, and Leave was the only exit.
--
-- Deliberately NOT an accept-or-decline invitation. That duplicates the
-- join-group flow, and once this setting exists there is nothing left for it to
-- prevent. What lands instead is a per-person rule the DATABASE enforces, plus
-- a line in the room saying who brought you.

create type public.group_add_policy as enum ('known', 'link_only');

alter table public.profiles
  add column group_adds public.group_add_policy not null default 'known';

-- NOT granted to any client role, and that is the point. `profiles` carries
-- column-level grants (20260816190000:354) precisely so that everything on it
-- is opt-in, and the app never star-reads it — 31_select_star_stays_readable
-- keeps profiles off its list for exactly this reason. The two functions below
-- are the whole client surface for this column.

-- ---------------------------------------------------------------------------
-- Reading and setting it
-- ---------------------------------------------------------------------------
-- Mirrors my_visibility / set_visibility (20260823040000:105-133): a definer
-- pair bound to auth.uid(), never a column a client can read on anybody else.

create function public.my_group_adds()
returns public.group_add_policy
language sql
stable
security definer
set search_path = public
as $$
  select group_adds from public.profiles where user_id = auth.uid()
$$;

create function public.set_group_adds(p_policy public.group_add_policy)
returns public.group_add_policy
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.profiles set group_adds = p_policy where user_id = v_user;
  return p_policy;
end
$$;

revoke execute on function public.my_group_adds() from public, anon;
grant execute on function public.my_group_adds() to authenticated;
revoke execute on function public.set_group_adds(public.group_add_policy) from public, anon;
grant execute on function public.set_group_adds(public.group_add_policy) to authenticated;

-- ---------------------------------------------------------------------------
-- Who put you here
-- ---------------------------------------------------------------------------

alter table public.room_members
  add column added_by uuid references public.users (id) on delete set null;

-- room_members carries a TABLE-level select grant (20260817200000:95), so the
-- new column rides the grant already there and `select *` keeps working.

/**
 * The name of whoever added this reader to this chat, or null.
 *
 * Null covers every case where there is nothing to say: nobody was recorded,
 * the person joined by link or by themselves, or they added themselves. A
 * definer function rather than a wider group_members signature, because
 * group_members is a RETURNS TABLE function and adding an OUT column to one
 * means dropping it and restating its grants — a bigger blast radius than one
 * line of a room screen is worth.
 */
create function public.who_added_me(p_chat_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.display_name
    from public.room_members rm
    join public.profiles p on p.user_id = rm.added_by
   where rm.chat_id = p_chat_id
     and rm.user_id = auth.uid()
     and rm.added_by is distinct from auth.uid()
$$;

revoke execute on function public.who_added_me(uuid) from public, anon;
grant execute on function public.who_added_me(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Adding somebody, with their rule honoured
-- ---------------------------------------------------------------------------
--
-- `create or replace` is correct: the return type is jsonb and does not
-- change. Body restated whole from 20260829130000:235, with the policy check
-- added after the knows_traveler test and added_by written into the insert.
-- Enforced in the RPC so it holds for any caller, not only this client.

create or replace function public.add_to_group(p_chat_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_max date;
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.assert_good_standing();
  if public.is_guest_account(v_user) then
    raise exception 'make an account to add people to a group'
      using errcode = 'check_violation';
  end if;
  if p_user_id is not distinct from v_user then
    raise exception 'You are already in this group.' using errcode = 'check_violation';
  end if;

  select g.max_stay_until into v_max
    from public.groups g
    join public.chats c on c.id = g.chat_id and c.status = 'active'
   where g.chat_id = p_chat_id;
  if not found then
    raise exception 'That group is not open.' using errcode = '42501';
  end if;
  if public.group_chat_closed(p_chat_id) then
    raise exception 'This chat has ended.' using errcode = '42501';
  end if;

  if not (public.is_room_member(p_chat_id) or public.is_room_moderator(p_chat_id)) then
    raise exception 'That group is not open.' using errcode = '42501';
  end if;

  -- You may only bring somebody you actually know. Without this, a member
  -- could add any uuid they could get hold of, which is a way of putting a
  -- stranger in front of you that skips the say-hi gate entirely.
  if not public.knows_traveler(p_user_id) then
    raise exception 'You can only add people you have chatted with.'
      using errcode = '42501';
  end if;
  if public.is_blocked_pair(p_user_id)
     or public.is_business_account(p_user_id)
     or public.is_guest_account(p_user_id) then
    raise exception 'You can only add people you have chatted with.'
      using errcode = '42501';
  end if;

  -- Their rule, not the adder's. Said as a fact about them rather than as a
  -- refusal of the person adding, and it gives away nothing they have not
  -- already decided to publish by choosing it.
  if (select group_adds from public.profiles where user_id = p_user_id) = 'link_only' then
    raise exception 'They only join groups by invite link.' using errcode = '42501';
  end if;

  if (
    select coalesce(max(created_at) filter (where action = 'removed_by_moderator'),
                    '-infinity'::timestamptz)
         > coalesce(max(created_at) filter (where action = 'readmitted_by_moderator'),
                    '-infinity'::timestamptz)
      from public.moderation_events
     where subject_user_id = p_user_id
       and entity_type = 'room_member'
       and entity_id = p_chat_id
  ) then
    raise exception 'An admin removed them from this group.' using errcode = '42501';
  end if;

  -- Same horizon the group gives anybody who joins by link: a week of grace
  -- past its last day, or no end at all when it has none.
  v_expires := case
    when v_max is null then 'infinity'::timestamptz
    else (v_max + 7)::timestamptz
  end;

  insert into public.room_members (chat_id, user_id, departure_date, expires_at, added_by)
  values (p_chat_id, p_user_id, v_max, v_expires, v_user)
  on conflict (chat_id, user_id) do update
    set expires_at = greatest(room_members.expires_at, excluded.expires_at),
        archived_at = null,
        -- Whoever brought them back in is who brought them in.
        added_by = excluded.added_by;

  return jsonb_build_object('chat_id', p_chat_id, 'user_id', p_user_id);
end
$$;

revoke execute on function public.add_to_group(uuid, uuid) from public, anon;
grant execute on function public.add_to_group(uuid, uuid) to authenticated;
