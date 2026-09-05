/**
 * The line above a bubble that says what it answers.
 *
 * Two sources, one shape. A direct chat reads the `messages` table and
 * resolves the parent from whatever is loaded; a room reads room_messages,
 * which joins the parent's name and first line server-side because the room
 * thread cannot see other people's profiles from here.
 */
export type Quote = {
  name: string;
  body: string | null;
  /**
   * Why the line is missing, which is NOT one question but two.
   *
   * 'gone' is a parent the thread has stopped showing: taken back by its
   * sender, or taken down. 'offPage' is a parent that exists and is simply
   * older than the pages loaded so far - in a long chat, answering something
   * from last week puts it 160 rows back. Collapsing the two told the reader
   * a message had been deleted when one more page would have shown it to
   * them, which is a worse lie than saying nothing.
   */
  state: 'known' | 'offPage' | 'gone';
};

/**
 * What the strip says when the parent is not on any loaded page.
 *
 * A neutral word rather than a guess: the bubble is still an answer to
 * something, and saying so with no name is honest where inventing one is not.
 */
export const OFF_PAGE_QUOTE_NAME = 'Message';

type Quotable = {
  id: string;
  sender_id: string;
  body: string | null;
  unsent_at?: string | null;
  removed_at?: string | null;
};

/**
 * Resolve a quote from the loaded thread.
 *
 * `nameFor` is the caller's, because who a message is FROM is a different
 * question in a one-to-one chat (two people, both known) than in a group.
 * A parent that has been taken back or taken down keeps its name and loses
 * its line: the reader must not go on reading, inside a quote, something the
 * thread itself has stopped showing.
 */
export function quoteFromPage(
  parentId: string | null | undefined,
  messages: readonly Quotable[],
  nameFor: (message: Quotable) => string
): Quote | null {
  if (parentId == null) {
    return null;
  }
  const parent = messages.find((message) => message.id === parentId);
  if (!parent) {
    return { name: OFF_PAGE_QUOTE_NAME, body: null, state: 'offPage' };
  }
  const gone = parent.unsent_at != null || parent.removed_at != null;
  return {
    name: nameFor(parent),
    body: gone ? null : parent.body,
    state: gone ? 'gone' : 'known',
  };
}

/** Resolve a quote from a room row, where the server did the join. */
export function quoteFromRow(
  row:
    | {
        reply_to_message_id: string | null;
        reply_to_name: string | null;
        reply_to_body: string | null;
      }
    | null
    | undefined
): Quote | null {
  if (!row?.reply_to_message_id) {
    return null;
  }
  // The server joined it, so a null body here means the parent really is
  // unsent or removed - room_messages returns the id and drops the line for
  // exactly those two cases. There is no off-page state on this path.
  return {
    name: row.reply_to_name ?? OFF_PAGE_QUOTE_NAME,
    body: row.reply_to_body,
    state: row.reply_to_body == null ? 'gone' : 'known',
  };
}
