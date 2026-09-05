import type { GroupInvitesWho } from '@/lib/database.types';

/**
 * Who may hand out the link, as the group's own page says it.
 *
 * A travel group grows by whoever is physically present, so the default is
 * everyone. What stays the admin's is turning a live link OFF, which is the
 * whole reason widening this is safe.
 */
export const INVITE_OPTIONS: { value: GroupInvitesWho; label: string }[] = [
  { value: 'everyone', label: 'Anyone in the group' },
  { value: 'admin', label: 'Only the admin' },
];

/**
 * Whether this reader may hand out the invite link.
 *
 * The SAME rule the database enforces in group_invite_token:
 *
 *   is_room_moderator(chat) or (is_room_member(chat) and groups.invites = 'everyone')
 *
 * Written here so the screen and the server cannot drift into disagreeing —
 * a client that offers a control the server refuses is worse than one that
 * hides a control the server would allow.
 */
export function canInviteToGroup(input: {
  isAdmin: boolean;
  invites: GroupInvitesWho | null | undefined;
}): boolean {
  return input.isAdmin || input.invites === 'everyone';
}
