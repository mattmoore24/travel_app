import fs from 'node:fs';
import path from 'node:path';

import { archiveStampKey, newlyArchived } from '@/features/chat/archive-notice';
import { between } from '@/lib/__tests__/source';

/**
 * The notice that stops an auto-archive being a disappearance.
 *
 * `archive_idle_chats` moves any chat with nothing said in it for fourteen
 * days, at 03:30, silently. The window stays; the silence does not. What is
 * under test here is the arithmetic that decides whether there is anything to
 * say, because getting it wrong in either direction is worse than the bug:
 * too eager and the app announces chats the person archived themselves, too
 * shy and it never says anything at all.
 */

const at = (iso: string) => ({ archived_at: iso });

describe('how many archives are news', () => {
  const stamp = '2026-09-01T12:00:00.000Z';

  it('says nothing when nothing is archived', () => {
    expect(newlyArchived([], stamp)).toBe(0);
  });

  it('says nothing about chats archived before the person was last told', () => {
    expect(
      newlyArchived([at('2026-08-20T03:30:00.000Z'), at('2026-09-01T11:59:00.000Z')], stamp)
    ).toBe(0);
  });

  it('counts the ones archived since', () => {
    expect(
      newlyArchived(
        [
          at('2026-08-20T03:30:00.000Z'),
          at('2026-09-02T03:30:00.000Z'),
          at('2026-09-03T03:30:00.000Z'),
        ],
        stamp
      )
    ).toBe(2);
  });

  it('counts nothing at all on a first run', () => {
    // An account that has been running for months would otherwise be met with
    // "14 quiet chats moved to Archived" on the launch after this ships,
    // about conversations it stopped thinking about long ago. The stamp is
    // written on that pass and the notice works from then on.
    expect(
      newlyArchived([at('2026-08-20T03:30:00.000Z'), at('2026-08-30T03:30:00.000Z')], null)
    ).toBe(0);
  });

  it('never counts a chat somebody archived by hand', () => {
    // The hand archive writes the stamp itself, on the mutation's success,
    // which is necessarily after the server stamped archived_at. Strictly
    // after, so the two cannot tie.
    const archivedByHand = '2026-09-04T09:00:00.000Z';
    const stampedRightAfter = '2026-09-04T09:00:00.100Z';
    expect(newlyArchived([at(archivedByHand)], stampedRightAfter)).toBe(0);
    expect(newlyArchived([at(archivedByHand)], archivedByHand)).toBe(0);
  });

  it('ignores a row with no archived_at and an unreadable stamp', () => {
    expect(newlyArchived([{ archived_at: null }], stamp)).toBe(0);
    expect(newlyArchived([at('2026-09-09T03:30:00.000Z')], 'not a date')).toBe(0);
  });

  it('keeps two people on one phone apart', () => {
    expect(archiveStampKey('user-a')).not.toBe(archiveStampKey('user-b'));
    expect(archiveStampKey(null)).toContain('anon');
  });
});

describe('the hand archive marks itself read', () => {
  const source = (...parts: string[]): string =>
    fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8');

  it('stamps the notice from useChatPref whenever the patch archived a chat', () => {
    // Without this the arithmetic above is correct and useless: both
    // archive_idle_chats and a swipe write chat_prefs.archived_at, so the
    // notice would fire at somebody for something they had just done.
    const hooks = source('features', 'rooms', 'hooks.ts');
    expect(hooks).toContain('stampArchiveNoticeRead');
    expect(hooks).toContain('variables.archived === true');
  });
});

describe('the words the notice uses', () => {
  const screen = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', '(tabs)', 'chat.tsx'),
    'utf8'
  );

  it('says what happened, with a count and no em dash', () => {
    expect(screen).toContain("{countOf(count, 'quiet chat')} moved to Archived");
    const line = between(screen, 'function ArchiveNotice', 'const WAITING_COLLAPSE_AT');
    expect(line).not.toContain('—');
  });

  it('stops painting Archive in the colour that means this takes something away', () => {
    // The app says twice that archiving is reversible and then painted the
    // action danger red, in the rightmost slot iOS trained thumbs to read as
    // delete. Red is kept for Unsend, Block, Leave and Remove.
    expect(screen).toContain('tint={theme.accentDeep}');
    expect(screen).toContain('onTint={theme.onAccentDeep}');
    expect(screen).not.toContain('tint={theme.danger}');
    // And Mute stops being a grey that reads as a disabled control.
    expect(screen).toContain('tint={theme.surfaceSunken}');
    expect(screen).not.toContain('tint={theme.textSecondary}');
  });

  it('keeps the door to Archived on the screen once the query has answered', () => {
    // It used to appear only after something had been archived, so the person
    // hunting for a name the sweep had moved had to already be behind it.
    expect(screen).toContain('{archivedQuery.isSuccess ? (');
    expect(screen).toContain("'Nothing archived yet'");
  });
});

/**
 * The hand-archive stamp has to reach the RUNNING hook.
 *
 * Both reviewers found the same hole: the stamp was read once on mount and
 * held in component state, while stampArchiveNoticeRead wrote only to
 * AsyncStorage. So archiving a chat yourself, in a session already open, left
 * the hook comparing against its stale mount-time stamp — and a moment later
 * the app announced the chat you had just moved as one it had moved for you.
 * That is the one thing the spec's Risk paragraph says must not happen.
 *
 * Source assertions, because the defect is the ABSENCE of a subscription: no
 * render test can see a value that was never published.
 */
describe('the stamp a hand archive writes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'archive-notice.ts'), 'utf8');

  it('is published to the running app, not only to storage', () => {
    expect(src).toContain('liveStamp.set(archiveStampKey(userId), at)');
    expect(src).toContain('notifyStampWatchers()');
    // Written to the store BEFORE storage, so a slow disk cannot let the
    // notice fire in the gap.
    expect(src.indexOf('liveStamp.set')).toBeLessThan(src.indexOf('AsyncStorage.setItem'));
  });

  it('is subscribed to, so the count recomputes without a remount', () => {
    expect(src).toContain('useSyncExternalStore(');
    expect(src).toContain('subscribeToStamp');
    expect(src).toContain('const stamp = live ?? state.stamp;');
  });

  it('reports nothing at all when the caller says it is not wanted', () => {
    // isBusiness resolves a round trip late, so the gate has to hold at the
    // value and not only at the fetch.
    expect(src).toContain('!enabled || dismissed');
  });
});
