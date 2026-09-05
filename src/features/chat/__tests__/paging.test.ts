import fs from 'node:fs';
import path from 'node:path';

import {
  MESSAGE_PAGE,
  flattenPages,
  mapEveryPage,
  mapFirstPage,
  nextBefore,
  pagesHave,
  type ThreadPages,
} from '@/features/chat/paging';

/**
 * Paging is where a conversation either continues or silently ends, and the
 * selector below is the whole of that decision: a short page means there is
 * nothing older, a full one hands back the cursor for the next.
 */

type Row = { id: string; created_at: string; local?: 'sending' | 'failed' };

const row = (id: string, minutesAgo: number): Row => ({
  id,
  created_at: new Date(Date.UTC(2026, 7, 31, 12, 0) - minutesAgo * 60_000).toISOString(),
});

/** Newest first, the way the thread reads. */
const fullPage = (size: number): Row[] =>
  Array.from({ length: size }, (_, index) => row(`m${index}`, index));

const pages = (...list: Row[][]): ThreadPages<Row> => ({
  pages: list,
  pageParams: list.map((_, index) => (index === 0 ? null : `p${index}`)),
});

describe('nextBefore', () => {
  it('ends paging when a page comes back short', () => {
    expect(nextBefore(fullPage(3), 10)).toBeNull();
  });

  it('ends paging on an empty page', () => {
    expect(nextBefore([], 10)).toBeNull();
  });

  it('hands back the oldest created_at when the page is full', () => {
    const page = fullPage(10);
    expect(nextBefore(page, 10)).toBe(page[9].created_at);
  });

  it('does not count a failed send, which is carried onto page 0 and is not a server row', () => {
    // Nine real rows plus one bubble that never left the device is not a full
    // page, and treating it as one spends a round trip on a conversation that
    // has already ended.
    const carried: Row[] = [{ id: 'local:1', created_at: row('x', -1).created_at }, ...fullPage(9)];
    expect(nextBefore(carried, 10)).toBeNull();
  });

  it('never hands back a local id as a cursor', () => {
    const carried: Row[] = [
      { id: 'local:1', created_at: row('x', -1).created_at },
      ...fullPage(10),
    ];
    expect(nextBefore(carried, 10)).toBe(fullPage(10)[9].created_at);
  });

  it('is used at the page size the chat actually asks for', () => {
    expect(MESSAGE_PAGE).toBe(100);
  });
});

describe('the page helpers', () => {
  it('flattens newest-first across pages', () => {
    const data = pages([row('a', 0)], [row('b', 10)]);
    expect(flattenPages(data).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('flattens an empty cache to an empty thread rather than throwing', () => {
    expect(flattenPages(undefined)).toEqual([]);
  });

  it('adds to the newest page only', () => {
    const data = pages([row('a', 0)], [row('b', 10)]);
    const next = mapFirstPage(data, (rows) => [row('new', -1), ...rows]);
    expect(next.pages[0].map((m) => m.id)).toEqual(['new', 'a']);
    expect(next.pages[1].map((m) => m.id)).toEqual(['b']);
  });

  it('seeds an empty cache, so an optimistic bubble beats the first fetch', () => {
    const next = mapFirstPage<Row>(undefined, (rows) => [row('new', 0), ...rows]);
    expect(next.pages).toEqual([[row('new', 0)]]);
    expect(next.pageParams).toEqual([null]);
  });

  it('changes a row wherever it is, because a verdict can land pages later', () => {
    const data = pages([row('a', 0)], [row('b', 10)]);
    const next = mapEveryPage(data, (rows) =>
      rows.map((m) => (m.id === 'b' ? { ...m, local: 'failed' as const } : m))
    );
    expect(next?.pages[1][0].local).toBe('failed');
  });

  it('leaves an empty cache alone rather than inventing one', () => {
    expect(mapEveryPage<Row>(undefined, (rows) => rows)).toBeUndefined();
  });

  it('knows whether a message is already loaded, on any page', () => {
    const data = pages([row('a', 0)], [row('b', 10)]);
    expect(pagesHave(data, 'b')).toBe(true);
    expect(pagesHave(data, 'c')).toBe(false);
    expect(pagesHave(undefined, 'a')).toBe(false);
  });
});

/**
 * The synthetic opening row, which is not a message and must never be paged
 * as if it were.
 *
 * The first message of a chat lives on the chat ROW, not in `messages`, and
 * the thread splices it in at the oldest end under a made-up `first:` id.
 * Feeding that id back as a cursor would ask the server for everything older
 * than a row it has never heard of.
 */
describe('the opening message is a render, not a page', () => {
  const thread = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'chat', '[id].tsx'),
    'utf8'
  );

  it('splices it into the rendered thread and never into the cache', () => {
    expect(thread).toContain('id: `first:${chat.chat_id}`');
    // Built from `messages`, which is what flattenPages returned, into a
    // separate `thread` const. Nothing writes it back.
    expect(thread).toContain('const thread =');
    expect(thread).not.toContain("setQueryData(['messages'");
  });

  it('only shows it once there is nothing older left to load', () => {
    // Otherwise the opening line and the note saying what it answered sat
    // above message one hundred, claiming the conversation began there.
    expect(thread).toContain('const atTheBeginning = !messagesQuery.hasNextPage;');
    expect(thread).toContain('chat.first_message && atTheBeginning');
  });
});
