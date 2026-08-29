-- A guest map stays faceless, open plans included
-- =============================================================================
--
-- public_city_pins strips every trace of a person from a guest's map — no
-- user_id, no display name, no age, no photo — because browsing PEOPLE is the
-- thing an account is for, and an anonymous identity is free to mint.
--
-- pin_crew, added yesterday, walked straight past that. It answers for any
-- caller holding the `authenticated` role, and an anonymous guest holds it, so
-- the faces on an open plan were a free read of names and photo paths for
-- every open pin in a city — exactly the harvest the guest feed exists to
-- prevent, and reachable without joining anything.
--
-- A guest can still JOIN an open plan and see the room from the inside, the
-- same as a group they hold a link for. That is a membership row somebody can
-- see and an admin can remove, which is the difference: it is accountable,
-- and it is capped at ten. Reading the roster of every plan in the city from
-- outside is neither.
--
-- Same OUT columns, so create-or-replace is correct and the grant survives.
-- Restated anyway.

create or replace function public.pin_crew(p_pin_id uuid)
returns table (
  user_id uuid,
  display_name text,
  photo_path text,
  is_owner boolean,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rm.user_id,
    pr.display_name,
    (select pp.storage_path from public.profile_photos pp
      where pp.user_id = rm.user_id and pp.moderation_status = 'approved'
      order by pp.position limit 1),
    rm.role = 'admin',
    rm.joined_at
  from public.pins p
  join public.groups g on g.pin_id = p.id
  join public.room_members rm on rm.chat_id = g.chat_id and rm.expires_at > now()
  left join public.profiles pr on pr.user_id = rm.user_id
  where p.id = p_pin_id
    and p.expires_at > now()
    and not public.is_guest_account()
    and (p.seeded or public.discovery_pair_ok(auth.uid(), p.user_id))
    and not public.is_blocked_pair(rm.user_id)
  order by (rm.role = 'admin') desc, rm.joined_at
  limit 20
$$;

revoke execute on function public.pin_crew(uuid) from public, anon;
grant execute on function public.pin_crew(uuid) to authenticated;

comment on function public.pin_crew(uuid) is
  'Who is already going, for the faces on an open plan. Empty for a guest: '
  'the guest map carries no identities at all, and this would have been the '
  'one door that did.';
