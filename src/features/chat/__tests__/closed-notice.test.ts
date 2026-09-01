import fs from 'node:fs';
import path from 'node:path';

import { closedNotice } from '@/features/chat/closed-notice';

/**
 * A block that says it landed.
 *
 * Blocking from inside a thread fired the mutation and did nothing else: no
 * navigation, no haptic, no confirmation. After a refetch a grey line appeared
 * reading "This chat is closed." — the same sentence the other person walking
 * away produces, because chat_status is 'closed' either way. So at the one
 * moment somebody most needs certainty, the app was ambiguous by design.
 */

describe('the line where the composer was', () => {
  it('names the block, and who it was, when the reader made it', () => {
    expect(closedNotice(true, 'Marco')).toBe('You blocked Marco. They cannot write to you.');
  });

  it('falls back to a word rather than an empty name', () => {
    expect(closedNotice(true, null)).toBe('You blocked this traveler. They cannot write to you.');
  });

  it('stays neutral about every other kind of closure', () => {
    // A person who left, an account that went away, a moderation close: none
    // of those are this reader's doing and none of them are theirs to explain.
    expect(closedNotice(false, 'Marco')).toBe('This chat is closed.');
  });

  it('carries no em dash and none of the banned vocabulary', () => {
    const both = `${closedNotice(true, 'Marco')} ${closedNotice(false, null)}`;
    expect(both).not.toContain('—');
    expect(both).not.toMatch(/\b(swipe|deck|match|request)\b/i);
  });
});

describe('what the thread does with it', () => {
  const source = (...parts: string[]): string =>
    fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8');

  it('reads the block from the server, not from a flag on the screen', () => {
    // A local flag dies with the screen, and the moment somebody wants to
    // check is usually not the moment they blocked.
    const thread = source('app', 'chat', '[id].tsx');
    expect(thread).toContain('const blocksQuery = useBlocks();');
    expect(thread).toContain('closedNotice(iBlockedThem, chat.title)');
  });

  it('waits for the blocks list before claiming a block', () => {
    // The guard has to point this way round. useBlockUser calls
    // invalidateQueries() with NO key, so everything in the app refetches at
    // once and this query joins that storm; a truthy default would tell
    // somebody, for a beat, that they had not blocked a person they just did.
    const thread = source('app', 'chat', '[id].tsx');
    const branch = thread.slice(
      thread.indexOf('const iBlockedThem ='),
      thread.indexOf('const messagesQuery =')
    );
    expect(branch).toContain('blocksQuery.isSuccess &&');
  });

  it('answers the block with a haptic, before the refetch storm', () => {
    const hooks = source('features', 'chat', 'hooks.ts');
    const mutation = hooks.slice(
      hooks.indexOf('export function useBlockUser()'),
      hooks.indexOf('export function useBlocks()')
    );
    expect(mutation.indexOf('haptics.success()')).toBeGreaterThan(-1);
    expect(mutation.indexOf('haptics.success()')).toBeLessThan(
      mutation.indexOf('queryClient.invalidateQueries()')
    );
  });

  it('gives the block a permanent home rather than an undo toast', () => {
    // Recovery lives on a settings row, so nothing has to be caught in the
    // seconds after the tap.
    expect(source('app', 'profile-me.tsx')).toContain("router.push('/blocked')");
    expect(source('app', '_layout.tsx')).toContain('<Stack.Screen name="blocked"');
  });
});
