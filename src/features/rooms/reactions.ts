import type { ReactionSummaryRow } from '@/lib/database.types';

/**
 * One toggle, as the ['reactions', chatId] cache will see it.
 *
 * `userId` is carried for parity with the server call and for any future
 * summary shape that names reactors; today the viewer is identified in the
 * rows by `reacted_by_me`, so the id itself is not consulted.
 */
export type ToggleInput = {
  messageId: string;
  emoji: string;
  /** true sets the emoji (replacing yours), false takes yours back. */
  on: boolean;
  userId: string | null;
};

/**
 * The server's one-reaction-per-person rule, applied to the cached summary
 * rows so a tapback can appear the instant it is picked instead of after two
 * round trips (`set_reaction`, then the invalidated summary refetch — an age
 * on hostel wifi, spent staring at the one thing that is supposed to change).
 *
 * Pure on purpose: the optimistic write in useToggleReaction is only this
 * function fed to setQueryData, in exactly the shape fetchReactions returns,
 * so the eventual refetch (onSettled invalidates) replaces it without a jump.
 */
export function applyToggle(rows: ReactionSummaryRow[], input: ToggleInput): ReactionSummaryRow[] {
  const { messageId, emoji, on } = input;

  if (!on) {
    // Taking yours back: decrement the row you are on, drop it at zero.
    return rows
      .map((row) =>
        row.message_id === messageId && row.emoji === emoji && row.reacted_by_me
          ? { ...row, count: row.count - 1, reacted_by_me: false }
          : row
      )
      .filter((row) => row.count > 0);
  }

  // Setting one: your previous emoji on this message comes off first, the
  // same single-statement move the server makes. Nobody stacks six.
  const cleared = rows
    .map((row) =>
      row.message_id === messageId && row.reacted_by_me
        ? { ...row, count: row.count - 1, reacted_by_me: false }
        : row
    )
    .filter((row) => row.count > 0);

  const existing = cleared.find((row) => row.message_id === messageId && row.emoji === emoji);
  if (existing) {
    return cleared.map((row) =>
      row === existing ? { ...row, count: row.count + 1, reacted_by_me: true } : row
    );
  }
  return [...cleared, { message_id: messageId, emoji, count: 1, reacted_by_me: true }];
}
