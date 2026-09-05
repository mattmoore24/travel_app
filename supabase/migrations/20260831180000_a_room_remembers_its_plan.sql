-- A room remembers its plan
-- =============================================================================
--
-- Someone taps "Anyone can join" on a rooftop plan for tonight and lands in a
-- room that says nothing about the rooftop, the night, or how long the plan
-- has left. The pin expires in at most 72 hours and the room does not show
-- the clock, so the most time-sensitive fact in the product is invisible in
-- the only place people coordinate. 20260829120000 deliberately lets the chat
-- outlive the pin, which is right; it also means the room has to carry the
-- plan itself while the pin is alive, and say so plainly once it is not.
--
-- A NEW function, on purpose. The temptation is to add pin fields to
-- my_chats or room_info; both are RETURNS TABLE, so both would need
-- drop-function-first plus re-stated grants, which is the deploy failure
-- AGENTS.md warns about. A separate reader avoids the whole class.
--
-- SECURITY DEFINER and member-gated, also on purpose. The pins policies key
-- discovery to the pin's OWNER (audience both ways, blocks both ways), and
-- that filter is right for the map. It is wrong inside the room: a joiner is
-- already in the chat with these people, and hiding the plan's own venue
-- from them because the owner later narrowed an audience would be a room
-- that forgets its reason for existing. Membership is the gate; the pin id
-- tells a non-member nothing.
--
-- Hard rule 3 is enforced in the body: an expired pin is unreadable, so the
-- read stops at expires_at even in the window before expire_pins sweeps the
-- row. The function reads the expiry; nothing here extends it.

create function public.pin_for_group(p_chat_id uuid)
returns table (
  pin_id uuid,
  venue_name text,
  place_label text,
  category public.pin_category,
  intent_date date,
  expires_at timestamptz,
  lat double precision,
  lng double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.venue_name,
    p.place_label,
    p.category,
    p.intent_date,
    p.expires_at,
    p.lat,
    p.lng
  from public.groups g
  join public.pins p on p.id = g.pin_id
  where g.chat_id = p_chat_id
    and p.expires_at > now()
    and public.is_room_member(p_chat_id)
$$;

revoke execute on function public.pin_for_group(uuid) from public, anon;
grant execute on function public.pin_for_group(uuid) to authenticated;

comment on function public.pin_for_group(uuid) is
  'The pin a group opened from, for the room''s own plan card: venue, day, '
  'expiry, coordinates. Members only, and definer on purpose — a joiner is '
  'already in the room, so the pin owner''s discovery filter must not hide '
  'the plan from them. Empty once the pin has expired (hard rule 3) or been '
  'taken down; the group survives that as an ordinary group.';

-- The ended state has to survive the sweep. expire_pins hard-deletes expired
-- rows every fifteen minutes and groups.pin_id goes null ON DELETE SET NULL,
-- so a card gated on pin_id alone vanishes without its "burned out" line the
-- moment the sweep runs. Stamp the group as the pin leaves; the groups table
-- carries a TABLE-level select grant, so the new column rides into select *.
alter table public.groups
  add column plan_ended_at timestamptz;

create function public.groups_remember_the_plan_ended()
returns trigger
language plpgsql
as $$
begin
  update public.groups
     set plan_ended_at = now()
   where pin_id = old.id
     and plan_ended_at is null;
  return old;
end
$$;

create trigger pins_stamp_their_groups
  before delete on public.pins
  for each row execute function public.groups_remember_the_plan_ended();

notify pgrst, 'reload schema';
