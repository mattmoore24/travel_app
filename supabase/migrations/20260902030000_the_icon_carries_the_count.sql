-- The home-screen icon carries the count
-- ---------------------------------------------------------------------------
--
-- The push worker never sends a `badge` value and the client never calls
-- setBadgeCountAsync, so the number on the app icon is permanently zero. A
-- traveler who swipes a banner away in a noisy hostel has no trace at all
-- that somebody is waiting, and an unanswered hello reads to the SENDER as a
-- decline - which is exactly the signal the no-decline-notification design
-- exists to suppress.
--
-- Two sides, and neither is worth much alone. The notification handler's
-- shouldSetBadge only increments while the app is running, and a client-side
-- write only lands the next time somebody opens the app. This is the server
-- half.
--
-- WHY A FUNCTION AND NOT A COLUMN. The obvious shape is a `badge` column on
-- push_queue, and it is wrong twice: it would freeze the count at enqueue
-- time, so a row drained a minute later carries a stale number, and it would
-- need populating at every one of the thirty-odd places that write to the
-- queue. Computed once per drain batch it is one extra round trip and always
-- current.
--
-- WHY NO CLIENT MAY CALL IT. It reads other people's unread state in bulk. A
-- stray `grant execute ... to authenticated` turns it into an enumeration of
-- who has unread messages, which is the enumerability failure the review
-- brief warns about. The service role reaches it through its own rights, the
-- way push-worker already reaches push_queue. The pgTAP asserts the refusal
-- rather than trusting the absence of a grant.

create or replace function public.waiting_counts(p_users uuid[])
returns table (user_id uuid, waiting int)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    coalesce(c.n, 0) + coalesce(r.n, 0)
  from unnest(p_users) as u(id)
  -- Conversations with something new in them, muted ones excluded. Muting is
  -- somebody saying "do not interrupt me about this", and a number on the
  -- icon is an interruption; the row keeps its own dot either way. This is
  -- src/features/chat/unread.ts:waitingTotal, in SQL.
  left join lateral (
    select count(*)::int as n
    from (
      -- Membership, restated from my_chats' own `mine` CTE
      -- (20260902000000:77) with the passed id where it says auth.uid().
      -- Archived threads are excluded below, the way my_chats(false) does.
      -- kind rides along for the shadowban clause below, which my_chats
      -- applies and this restatement must apply identically.
      select ch.id, ch.created_at, ch.kind
      from public.chats ch
      join public.chat_participants cp on cp.chat_id = ch.id and cp.user_id = u.id
      where ch.kind in ('direct', 'business')
      union
      select ch.id, ch.created_at, ch.kind
      from public.chats ch
      join public.room_members rm on rm.chat_id = ch.id and rm.user_id = u.id
      -- A closed group is a finished conversation its members keep.
      where rm.expires_at > now() or rm.role = 'admin'
         or public.group_chat_closed(ch.id)
      union
      select ch.id, ch.created_at, ch.kind
      from public.chats ch
      join public.businesses b on b.chat_id = ch.id
      join public.business_staff s on s.business_id = b.id and s.user_id = u.id
      union
      select ch.id, ch.created_at, ch.kind
      from public.chats ch
      join public.businesses b on b.chat_id = ch.id
      where b.owner_user_id = u.id
    ) m
    left join public.chat_prefs pref on pref.chat_id = m.id and pref.user_id = u.id
    left join public.chat_participants cpmine
      on cpmine.chat_id = m.id and cpmine.user_id = u.id
    left join public.room_members rmine on rmine.chat_id = m.id and rmine.user_id = u.id
    where pref.archived_at is null
      and not coalesce(pref.muted, false)
      -- The shadowban clause my_chats ends on (20260902000000:203-210), which
      -- this restatement had dropped. Shadowbanning only works if it is total
      -- for everybody else, and a business reading its inbox is everybody
      -- else: my_chats hides a business thread from the owner once the
      -- traveller on the other end stops being visible, so a badge that went
      -- on counting it pointed at a conversation the list refuses to show.
      -- A number on an icon that cannot be cleared is worse than no number.
      and (
        m.kind <> 'business'
        or not public.is_business_account(u.id)
        or public.is_visible_owner(
             (select cp2.user_id
                from public.chat_participants cp2
               where cp2.chat_id = m.id and cp2.user_id <> u.id
               limit 1)
           )
      )
      -- THE unread predicate, character for character the one my_chats
      -- counts with (20260902000000:145-159). Two definitions of "waiting"
      -- that can drift apart is the whole risk in this change, which is why
      -- the pgTAP asserts this function against my_chats rather than against
      -- a hand-written expectation.
      and exists (
        select 1
        from public.messages msg
        where msg.chat_id = m.id
          and msg.sender_id <> u.id
          and msg.removed_at is null
          and msg.unsent_at is null
          and msg.moderation_status = 'approved'
          and msg.created_at > coalesce(
            pref.last_read_at,
            rmine.joined_at,
            cpmine.created_at,
            m.created_at
          )
      )
  ) c on true
  -- Plus the hellos still waiting on an answer, which is the other half of
  -- what the Chat tab's badge counts. A business never has any (a hello to a
  -- business is refused at the DB layer), so this term is simply zero there
  -- and needs no special case.
  left join lateral (
    select count(*)::int as n
    from public.message_requests mr
    where mr.recipient_id = u.id and mr.status = 'pending'
  ) r on true
$$;

revoke all on function public.waiting_counts(uuid[]) from public, anon, authenticated;

comment on function public.waiting_counts(uuid[]) is
  'Conversations with something new plus hellos awaiting an answer, per user. '
  'The push worker''s badge number, computed at drain time so it is never '
  'stale. Service role only: it reads across users and any client grant would '
  'make it a bulk enumeration of who has unread messages.';
