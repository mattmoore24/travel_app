import type { SentRequestRow } from '@/lib/database.types';

/**
 * Which of your own hellos belong under "You said hi".
 *
 * The obvious answer, and the one the Chat tab used to hold inline, is
 * `state === 'sent'`. It is right about two of the three states and wrong
 * about the third in a way that destroys writing.
 *
 * 'accepted' is out: that hello IS a conversation now and has a row of its
 * own in the list below.
 *
 * 'blocked' splits in two, and the split is the whole point of this file:
 *
 *   * The PREFILTER refused it in the composer, with the text still in the
 *     box, after a warning the person had already read. Nothing was lost and
 *     nothing is waiting, so it stays out of the list. That is what the Chat
 *     tab's old comment was right about.
 *   * The CLASSIFIER came back minutes after the app had said the message
 *     was on its way. Dropping that row means the app confirmed a message
 *     and then deleted the record of it, and because a first message is one
 *     shot per pair for ever, the sender can never write to that person
 *     again. `blocked_after_send` is true for exactly this case, and those
 *     rows stay so the sender can find what they wrote and rewrite it.
 *
 * Neither branch says anything about the recipient: a block is our own
 * moderation of the sender's own text, which is the sender's business.
 */
export function waitingRows(rows: SentRequestRow[]): SentRequestRow[] {
  return rows.filter(
    (row) =>
      // A hello the sender took back is not one they are waiting on. It is
      // carried as a COLUMN rather than a fourth state (see
      // SentRequestRow.withdrawn_at for why), which means every reader has to
      // remember it - and this is the reader that decides whether the row is
      // still on screen. Without this clause the whole withdraw feature has
      // no visible effect: the server stamps the row, the list refetches
      // byte-identically, and "You said hi to Ana" stays up for ever.
      row.withdrawn_at == null &&
      (row.state === 'sent' || (row.state === 'blocked' && row.blocked_after_send))
  );
}
