import type { InfiniteData } from '@tanstack/react-query';

import { isLocalId } from '@/features/chat/outgoing';

/**
 * Paging a conversation, for the two thread caches that share a shape.
 *
 * A thread is newest-first (the list is inverted), so "the next page" is
 * OLDER, and the cursor is the oldest `created_at` already loaded. Keeping
 * the arithmetic here rather than in either hook is what stops a direct chat
 * and a room disagreeing about when a conversation has ended.
 */

/** One screenful of a one-to-one chat. */
export const MESSAGE_PAGE = 100;

/** One screenful of a room. Matches room_messages' own default. */
export const ROOM_MESSAGE_PAGE = 60;

/**
 * Newest page first, each page newest-first inside itself.
 *
 * The page parameter stays `unknown` (React Query's own default) rather than
 * `string | null`: the hooks infer it from `initialPageParam`, and pinning it
 * here would make every `getQueryData` at the call sites a type error about a
 * generic nobody reads.
 */
export type ThreadPages<T> = InfiniteData<T[]>;

/**
 * The cursor for the page before this one, or null when the conversation has
 * run out.
 *
 * Local rows are excluded from both halves. A failed send is carried onto
 * page 0 by `carryFailed`, so counting it would make a short page look full
 * and its made-up id would be a cursor no server row sits behind.
 */
export function nextBefore<T extends { id: string; created_at: string }>(
  page: T[],
  pageSize: number
): string | null {
  const fromServer = page.filter((row) => !isLocalId(row.id));
  if (fromServer.length < pageSize) {
    return null;
  }
  return fromServer[fromServer.length - 1].created_at;
}

/** Every loaded page as one newest-first array, which is what a thread renders. */
export function flattenPages<T>(data: ThreadPages<T> | undefined): T[] {
  return (data?.pages ?? []).flat();
}

/**
 * Change the NEWEST page and leave the rest alone — where an arriving message
 * and an optimistic bubble both belong.
 *
 * An empty cache is seeded rather than skipped: the optimistic bubble has to
 * appear even when the send is the very first thing that happens on a screen
 * whose first fetch has not landed.
 */
export function mapFirstPage<T>(
  data: ThreadPages<T> | undefined,
  fn: (rows: T[]) => T[]
): ThreadPages<T> {
  if (!data || data.pages.length === 0) {
    return { pages: [fn([])], pageParams: [null] };
  }
  return { ...data, pages: [fn(data.pages[0]), ...data.pages.slice(1)] };
}

/**
 * Change every page. Used where a row is identified by id rather than by
 * position — an unsend stamp, a moderation verdict — because the row in
 * question may be several pages back by the time the answer arrives.
 */
export function mapEveryPage<T>(
  data: ThreadPages<T> | undefined,
  fn: (rows: T[]) => T[]
): ThreadPages<T> | undefined {
  if (!data) {
    return data;
  }
  return { ...data, pages: data.pages.map(fn) };
}

/** Whether any loaded page already holds this id. */
export function pagesHave<T extends { id: string }>(
  data: ThreadPages<T> | undefined,
  id: string
): boolean {
  return (data?.pages ?? []).some((page) => page.some((row) => row.id === id));
}
