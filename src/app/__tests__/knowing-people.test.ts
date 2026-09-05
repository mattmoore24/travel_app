import fs from 'node:fs';
import path from 'node:path';

import { after, between } from '@/lib/__tests__/source';

/**
 * The three doors that come with "people you already know".
 *
 * Founder: "you should be able to search anyone and add them directly to
 * activities or group chats that you've added or chatted with before directly
 * in the app rather than forcing people to invite people with a link... You
 * also should be able to message other users freely once both users are part
 * of the same group chat just by clicking the users profile and sending them
 * a message, no need to 'say hi' and wait for them to accept."
 *
 * Source assertions because what is guarded here is which affordance appears
 * on which screen and under which condition, and a render test of any one of
 * them proves nothing about the other two.
 */
const source = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('a face in a chat is a person you can reach', () => {
  const group = source('group', '[id].tsx');

  it('opens a member instead of doing nothing', () => {
    // Every row used to be inert text unless you were the admin, and then it
    // opened a moderation menu. Tapping now opens the person.
    expect(group).toContain("pathname: '/profile/[userId]'");
    expect(group).toContain("params: { userId: member.user_id, from: 'group', chatId }");
  });

  it('keeps the admin tools reachable, on their own control', () => {
    // Moved rather than removed: the row's tap is the profile now, so the
    // ellipsis that was decoration becomes the button.
    expect(group).toContain('accessibilityLabel={`Manage ${name}`}');
    expect(group).toContain('onPress={openActions}');
  });

  it('lets anybody in the group bring somebody, not only the admin', () => {
    const addBlock = after(group, 'group-add-people');
    expect(addBlock).toContain("pathname: '/add-people/[chatId]'");
    // Not wrapped in an isAdmin branch: the row before it is the member map,
    // and the admin-only hint comes after.
    const beforeAdd = between(group, '{members.map(', 'group-add-people');
    expect(beforeAdd).not.toContain('isAdmin ?');
  });

  it('gives a group a way out, which it did not have', () => {
    // "group", not "chat": a traveler-made one is a group everywhere it is
    // named, and "chat" is only ever a one-to-one.
    expect(group).toContain('Leave this group');
    expect(group).toContain('leaveRoom.mutate');
  });
});

describe('messaging somebody you already share a chat with', () => {
  const profile = source('profile', '[userId].tsx');

  it('asks the server whether you two are in a group, rather than guessing', () => {
    expect(profile).toContain('useSharesGroupWith(userId ?? null)');
    expect(profile).toContain('const known = connected || sharesGroup;');
  });

  it('offers Message and Add to a group only to somebody you know', () => {
    expect(profile).toContain('{known ? (');
    expect(profile).toContain("pathname: '/message/[userId]'");
    expect(profile).toContain("pathname: '/add-to-group/[userId]'");
  });

  it('opens the chat you already have instead of composing a new hello', () => {
    expect(profile).toContain("chat.other_user_id === userId && chat.kind === 'direct'");
    expect(profile).toContain("pathname: '/chat/[id]'");
  });

  it('drops the say-hi bubbles once you share a group, not only once connected', () => {
    // They are a slower way to open a conversation you can already have —
    // and once a hello is already on its way, every bubble would route into
    // the same unique-constraint refusal.
    expect(profile).toContain('known || alreadySaidHi || !userId');
  });
});

describe('the message screen is a field and Send, not the say-hi gate', () => {
  const message = source('message', '[userId].tsx');

  it('goes through open_direct_chat and lands in the chat', () => {
    expect(message).toContain('useOpenDirectChat');
    expect(message).toContain("router.replace({ pathname: '/chat/[id]'");
  });

  it('says what happened when moderation stops the first message', () => {
    // §7 rule 5 still applies with no accept step to hold it behind, so a
    // blocked message has to be a sentence and not a silent no-op.
    expect(message).toContain('result.blocked');
    expect(message).toContain('That one did not pass.');
  });

  it('carries no budget, no element picker and no waiting', () => {
    expect(message).not.toContain('useFirstMessageBudget');
    expect(message).not.toContain('ELEMENT_OPTIONS');
    expect(message).not.toContain('sendRequest');
  });
});
