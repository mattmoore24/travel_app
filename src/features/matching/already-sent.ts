import type { SentRequestRow } from '@/lib/database.types';

/**
 * Is a first message already out to this traveler?
 *
 * `unique(sender_id, recipient_id)` is one shot per direction, ever — the
 * anti-pester constraint — so any surface offering a second Say hi is
 * offering a send the server will refuse with an error that destroys the
 * draft.
 *
 * 'sent' is the one state that counts, and it covers more than it looks:
 * sent_requests() collapses delivered, held by moderation, silently declined
 * AND expired into that single word (invariant 4: a sender is never told
 * they were declined, and expiry rides along so a no cannot be told from
 * silence). An expired hello is therefore still counted here, which is
 * right — the sweep clears the recipient's inbox, it does not free the pair.
 *
 * 'blocked' does not count: nothing was delivered, the row is the sender's
 * own moderation feedback, and rewriting it is exactly what they are invited
 * to do. 'accepted' does not either — there is a chat, and the surfaces that
 * ask this question have their own, better answer for that.
 */
export function saidHiAlready(rows: SentRequestRow[], userId: string | null | undefined): boolean {
  if (!userId) {
    return false;
  }
  return rows.some((row) => row.recipient_id === userId && row.state === 'sent');
}

/**
 * Has that hello run out?
 *
 * The sibling question, and the one the copy beside a disabled control turns
 * on. `respond_to_message_request` only accepts a row that is still
 * 'pending', so once the nightly sweep has stamped `expired_at` there is
 * nobody left who can answer — and a note promising "it'll be in Chat if
 * they answer" is simply false.
 *
 * Read off `expired_at` rather than off `state`, because `state` deliberately
 * never learns a sixth word: see database.types' SentRequestRow for why an
 * over-the-air update cannot afford one.
 *
 * This tells the sender nothing about the recipient. Expiry runs on the
 * sender's own trip dates, which the sender already knows.
 */
export function helloExpired(rows: SentRequestRow[], userId: string | null | undefined): boolean {
  if (!userId) {
    return false;
  }
  return rows.some(
    (row) => row.recipient_id === userId && row.state === 'sent' && row.expired_at != null
  );
}
