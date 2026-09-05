import { INVITE_OPTIONS, canInviteToGroup } from '@/features/groups/invites';

/**
 * The screen's rule and the server's rule are the same sentence.
 *
 * group_invite_token refuses unless
 *   is_room_moderator(chat) or (is_room_member(chat) and invites = 'everyone')
 * so a client that offers Share to somebody the server will refuse produces a
 * dead button, and one that hides it from somebody the server would allow
 * takes the feature away. Both halves are tested here; the server half is
 * 40_who_can_invite.test.sql.
 */
describe('who the group page offers the link to', () => {
  it('offers it to any member while it is set to everyone', () => {
    expect(canInviteToGroup({ isAdmin: false, invites: 'everyone' })).toBe(true);
  });

  it('takes it away from a plain member once the admin closes it', () => {
    expect(canInviteToGroup({ isAdmin: false, invites: 'admin' })).toBe(false);
  });

  it('keeps it for the admin in both states, because they are a moderator', () => {
    expect(canInviteToGroup({ isAdmin: true, invites: 'admin' })).toBe(true);
    expect(canInviteToGroup({ isAdmin: true, invites: 'everyone' })).toBe(true);
  });

  it('says no while the group row has not arrived, rather than flashing a control', () => {
    expect(canInviteToGroup({ isAdmin: false, invites: null })).toBe(false);
    expect(canInviteToGroup({ isAdmin: false, invites: undefined })).toBe(false);
  });

  it('offers exactly the two states the enum has, in the app own words', () => {
    expect(INVITE_OPTIONS.map((option) => option.value)).toEqual(['everyone', 'admin']);
    expect(INVITE_OPTIONS.map((option) => option.label)).toEqual([
      'Anyone in the group',
      'Only the admin',
    ]);
  });
});
