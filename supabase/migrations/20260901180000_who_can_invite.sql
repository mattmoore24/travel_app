-- Anybody in a group can bring somebody in, with the admin keeping the switch.
--
-- Six people are in a city group; one meets a seventh in the hostel kitchen
-- and cannot bring them in, because group_invite_token raised 'group not
-- found' for anybody but a moderator. A travel group's membership grows by
-- whoever is physically present. The founder already made the matching call
-- once, in add_to_group (20260829130000:230-233): "Any member may add, not
-- only an admin ... it matches how the invite link already behaves" — except
-- the link did not behave that way.
--
-- The default is 'everyone', for existing groups too. Nobody chose admin-only
-- under the old rule: the app never offered the choice, so no decision is
-- being overridden. The mitigation is the kill switch, which stays the
-- admin's alone and is proven to still work in 40_who_can_invite.test.sql.

create type public.group_invites_who as enum ('everyone', 'admin');

alter table public.groups
  add column invites public.group_invites_who not null default 'everyone';

-- `groups` carries a TABLE-level select grant (20260821010000:42), so a new
-- column is covered by the grant already there and `select *` keeps working —
-- which fetchGroup depends on. 31_select_star_stays_readable.test.sql is the
-- standing proof.

-- ---------------------------------------------------------------------------
-- Minting a link
-- ---------------------------------------------------------------------------
--
-- `create or replace` is correct here: the return type is text and does not
-- change, so there is no OUT column for Postgres to refuse. Body restated
-- whole from 20260821010000:326, with the guard widened.

create or replace function public.group_invite_token(p_chat_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not (
    public.is_room_moderator(p_chat_id)
    or (
      public.is_room_member(p_chat_id)
      and (select g.invites from public.groups g where g.chat_id = p_chat_id) = 'everyone'
      -- Not a guest. add_to_group refuses them one RPC over ('make an account
      -- to add people to a group'), and a named guest who opened an invite
      -- link IS a room member of that group, so without this the widened
      -- guard hands them a live 30-day bearer token for the whole room to
      -- pass on to anybody - the same act the app refuses them next door.
      -- The client cannot reach it today (group/[id] sits behind
      -- signedIn && onboarded), which is exactly why it belongs in the RPC:
      -- the guard has to hold for any caller, not just for this screen.
      and not public.is_guest_account(auth.uid())
    )
  ) then
    raise exception 'group not found';
  end if;

  select token into v_token
    from public.group_invites
   where chat_id = p_chat_id and revoked_at is null and expires_at > now()
   order by created_at desc
   limit 1;

  if v_token is null then
    -- Two UUIDs' worth of hex: 64 url-safe characters and no dependency on an
    -- extension. pgcrypto's gen_random_bytes would be the obvious choice and
    -- is the wrong one here — Supabase keeps pgcrypto in an `extensions`
    -- schema the local test rig does not have, so the migration would pass in
    -- production and fail every time anybody ran the suite.
    v_token := replace(gen_random_uuid()::text, '-', '')
            || replace(gen_random_uuid()::text, '-', '');
    insert into public.group_invites (token, chat_id, created_by, expires_at)
    values (v_token, p_chat_id, auth.uid(), now() + interval '30 days');
  end if;

  return v_token;
end
$$;

-- revoke_group_invites is deliberately NOT widened. The kill switch is the
-- admin's, which is the same trust model WhatsApp uses, and it is the whole
-- mitigation for defaulting this to 'everyone'.

-- ---------------------------------------------------------------------------
-- Setting it
-- ---------------------------------------------------------------------------
--
-- DROP FIRST. Adding a defaulted parameter creates a second OVERLOAD rather
-- than replacing the original, and a seven-argument call then matches both and
-- fails with "function is not unique". PostgREST calls by named argument,
-- which does not save you (20260827170000:290-296). The drop removes the
-- grant, so it is restated below.

drop function if exists public.update_group(
  uuid, text, public.group_speaking, date, text, boolean, boolean);

create function public.update_group(
  p_chat_id uuid,
  p_name text default null,
  p_speaking public.group_speaking default null,
  p_max_stay_until date default null,
  p_photo_path text default null,
  p_clear_photo boolean default false,
  p_clear_max_stay boolean default false,
  -- Null means "leave it alone", the way every other parameter here does.
  p_invites public.group_invites_who default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_moderator(p_chat_id) then
    raise exception 'group not found';
  end if;
  -- Both at once is a client bug, not a user choice, and silently letting one
  -- win would hide it.
  if p_clear_max_stay and p_max_stay_until is not null then
    raise exception 'Pick a date or no end date, not both.' using errcode = 'check_violation';
  end if;
  if p_max_stay_until is not null and p_max_stay_until < current_date then
    raise exception 'That date has already passed.' using errcode = 'check_violation';
  end if;
  if p_max_stay_until is not null and p_max_stay_until > current_date + 400 then
    raise exception 'That is further out than a chat can be set. Pick a nearer day, or choose no end date.'
      using errcode = 'check_violation';
  end if;

  update public.groups
     set name = coalesce(btrim(p_name), name),
         speaking = coalesce(p_speaking, speaking),
         invites = coalesce(p_invites, invites),
         max_stay_until = case
           when p_clear_max_stay then null
           else coalesce(p_max_stay_until, max_stay_until)
         end,
         photo_path = case
           when p_clear_photo then null
           else coalesce(p_photo_path, photo_path)
         end
   where chat_id = p_chat_id;
end
$$;

revoke execute on function
  public.update_group(uuid, text, public.group_speaking, date, text, boolean, boolean,
                      public.group_invites_who)
from public, anon;
grant execute on function
  public.update_group(uuid, text, public.group_speaking, date, text, boolean, boolean,
                      public.group_invites_who)
to authenticated;
