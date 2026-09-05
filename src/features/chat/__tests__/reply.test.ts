import { OFF_PAGE_QUOTE_NAME, quoteFromPage, quoteFromRow } from '@/features/chat/reply';

/**
 * The quoted line is the whole feature: without it a reply is an ordinary
 * bubble and the room is back to parallel monologues. Three cases decide what
 * it says, and two of them are about a parent the reader is not entitled to
 * read any more.
 */

const message = (over: Partial<Parameters<typeof quoteFromPage>[1][number]> = {}) => ({
  id: 'm1',
  sender_id: 'them',
  body: 'Rooftop at 9?',
  ...over,
});

describe('a quote resolved from the loaded page', () => {
  const page = [message(), message({ id: 'm2', sender_id: 'me', body: "I'm in" })];
  const nameFor = (parent: { sender_id: string }) => (parent.sender_id === 'me' ? 'You' : 'Ana');

  it('is nothing at all for a message that answers nothing', () => {
    expect(quoteFromPage(null, page, nameFor)).toBeNull();
    expect(quoteFromPage(undefined, page, nameFor)).toBeNull();
  });

  it('names the sender and carries the first line', () => {
    expect(quoteFromPage('m1', page, nameFor)).toEqual({
      name: 'Ana',
      body: 'Rooftop at 9?',
      state: 'known',
    });
  });

  it('lets the caller decide what your own name is', () => {
    expect(quoteFromPage('m2', page, nameFor)).toEqual({
      name: 'You',
      body: "I'm in",
      state: 'known',
    });
  });

  it('still marks the bubble as an answer when the parent is pages back', () => {
    // A guess would be worse than a neutral word: the reply IS an answer to
    // something, and the app cannot say to what until that page loads.
    expect(quoteFromPage('gone', page, nameFor)).toEqual({
      name: OFF_PAGE_QUOTE_NAME,
      body: null,
      state: 'offPage',
    });
  });

  it('does not call a parent that is merely older than the page a deleted one', () => {
    // The whole point of the state field. Both cases have a null body, and
    // the strip says something different about each: one message still
    // exists and one more page would show it, the other has been taken back
    // or taken down. Telling a reader their friend deleted a message that is
    // sitting 160 rows up is a lie the app has no need to tell.
    expect(quoteFromPage('gone', page, nameFor)?.state).toBe('offPage');
    const unsent = [message({ id: 'm5', unsent_at: new Date().toISOString() })];
    expect(quoteFromPage('m5', unsent, nameFor)?.state).toBe('gone');
  });

  it('drops the line of a parent that was taken back, and keeps the name', () => {
    const unsent = [message({ id: 'm3', unsent_at: new Date().toISOString() })];
    expect(quoteFromPage('m3', unsent, nameFor)).toEqual({
      name: 'Ana',
      body: null,
      state: 'gone',
    });
  });

  it('drops the line of a parent a moderator took down', () => {
    const removed = [message({ id: 'm4', removed_at: new Date().toISOString() })];
    expect(quoteFromPage('m4', removed, nameFor)).toEqual({
      name: 'Ana',
      body: null,
      state: 'gone',
    });
  });
});

describe('a quote resolved from a room row', () => {
  it('is nothing at all when the row answers nothing', () => {
    expect(
      quoteFromRow({ reply_to_message_id: null, reply_to_name: null, reply_to_body: null })
    ).toBeNull();
    expect(quoteFromRow(undefined)).toBeNull();
    expect(quoteFromRow(null)).toBeNull();
  });

  it('uses the name and the line the server joined', () => {
    expect(
      quoteFromRow({
        reply_to_message_id: 'm1',
        reply_to_name: 'Ana',
        reply_to_body: 'Rooftop at 9?',
      })
    ).toEqual({ name: 'Ana', body: 'Rooftop at 9?', state: 'known' });
  });

  it('keeps the strip when the parent was unsent, which the server sends as a null line', () => {
    expect(
      quoteFromRow({ reply_to_message_id: 'm1', reply_to_name: 'Ana', reply_to_body: null })
    ).toEqual({ name: 'Ana', body: null, state: 'gone' });
  });

  it('falls back to the neutral word when the parent sender has no name', () => {
    expect(
      quoteFromRow({ reply_to_message_id: 'm1', reply_to_name: null, reply_to_body: 'later' })
    ).toEqual({ name: OFF_PAGE_QUOTE_NAME, body: 'later', state: 'known' });
  });
});
