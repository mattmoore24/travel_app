-- An invite link has to open for the person it was sent to
-- ===========================================================================
--
-- Founder, 2026-08-23: sent a friend a group invite, friend tapped it, got
-- "Could not load this invite. Try again."
--
-- The link was fine. group_invite_preview was granted to `authenticated`
-- only, so a signed-out tap came in as `anon`, got 42501, and the client
-- turned a permission error into a retry prompt for a link that would never
-- work. Worse, join-group/[token].tsx ALREADY had a branch that shows the
-- group and offers to make an account - it was unreachable, because the
-- query threw before the screen could decide anything. A whole designed
-- path, dead behind one missing grant.
--
-- Why granting anon is safe rather than a hole:
--
--   * The token is the capability. group_invite_token builds it from two
--     gen_random_uuid()s with the dashes stripped: 64 hex characters, about
--     244 bits. It is not guessable and it is not enumerable, which is the
--     same trust model every invite link on the internet runs on.
--   * The function already behaves correctly with a null auth.uid(). Both
--     places that could leak something check membership by uid, so a
--     signed-out caller gets photo_path null (the storage bucket would
--     refuse them the image anyway) and already_member false. No body
--     change is needed, only the grant.
--   * What a holder of the token learns is the name, the head count, the
--     latest stay date and whether posting is restricted. That is the
--     content of the invitation. Anyone who has the link was given it.
--   * Joining is untouched: join_group_with_invite stays authenticated-only,
--     so a guest can read who invited them and is then asked for an account.
--     Reading the invitation and accepting it are different privileges.

grant execute on function public.group_invite_preview(text) to anon;

comment on function public.group_invite_preview(text) is
  'Preview a group behind an invite token. Deliberately callable by anon: '
  'the 244-bit token is the capability, and a signed-out invitee has to be '
  'able to see what they were invited to before being asked for an account. '
  'Joining still requires one (join_group_with_invite is authenticated-only).';
