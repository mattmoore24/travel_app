-- What a room is called, before you are in it
-- ===========================================================================
--
-- A visitor reading a hostel's public preview saw a header that said "Guest
-- room". Not the hostel. Not the city. The literal words "Guest room", on
-- the screen whose entire job is to make a place feel like somewhere you
-- might walk into.
--
-- my_chats() carries the name, but only for members — which is exactly the
-- people who did not need it. This is the same fact, readable by anybody who
-- can already read the room.

create function public.room_info(p_chat_id uuid)
returns table (
  chat_id uuid,
  name text,
  kind text,
  member_count int,
  public_preview boolean,
  /** True for a traveler group, false for an establishment's room. */
  is_group boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    coalesce(e.name, g.name),
    coalesce(e.kind, 'group'),
    (select count(*)::int from public.room_members rm
      where rm.chat_id = c.id and rm.expires_at > now()),
    -- A traveler group is never publicly previewable; only a venue's room
    -- can be, and only when its owner has switched that on.
    coalesce(e.public_preview, false),
    g.chat_id is not null
  from public.chats c
  left join public.establishments e on e.chat_id = c.id and e.active
  left join public.groups g on g.chat_id = c.id
  where c.id = p_chat_id
    and c.kind = 'room'
    -- Readable by exactly the people who can already read the room itself,
    -- so this adds no visibility of its own: members and moderators, plus
    -- anybody at all for a venue that opted into a public preview.
    and (
      coalesce(e.public_preview, false)
      or public.is_room_member(c.id)
      or public.is_room_moderator(c.id)
    )
$$;

grant execute on function public.room_info(uuid) to anon, authenticated;

comment on function public.room_info(uuid) is
  'Name and size of one room, for the header a non-member sees. Adds no '
  'visibility: the WHERE mirrors who can already read the room.';
