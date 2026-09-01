import { render, screen } from '@testing-library/react-native';
import type { UseQueryResult } from '@tanstack/react-query';

import { IncomingRequestCard } from '@/features/matching/incoming-request-card';
import type { IncomingRequestRow } from '@/lib/database.types';

/**
 * A fold that arrives after the words is not a fold.
 *
 * The card used to default the reader's word list to `[]` while the query was
 * still in the air, so `mutedBy` was null on the first render and the first
 * message painted IN FULL until the second round trip landed. That is every
 * cold open of the inbox, which is the one time the list is not already
 * cached, and it is exactly the moment the fold exists for. The card's own
 * comment promised "the message is not rendered at all while this is up, so
 * VoiceOver cannot read past the fold either", which was false on the frame
 * that mattered.
 *
 * "Not yet known" is a third state, and these are the four answers the card
 * has to have for it. Note the fallback: a list that is not coming at all -
 * no session, no Supabase, a failed fetch - is NOT "not yet known", and the
 * hello is shown, because holding every first message behind a request that
 * will never arrive is a worse answer than the one this feature softens.
 */

const HELLO = 'Are you around for a drink at the night market on Friday?';

const mockList: { data: string[] | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: true,
};

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('@/features/matching/hooks', () => ({
  useRespondToRequest: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/features/chat/chat-row', () => ({ Avatar: () => null }));

// The matcher itself is the real one - the point of the test is which state
// the card is in, not whether a substring matches.
jest.mock('@/features/profile/muted-words', () => ({
  ...jest.requireActual('@/features/profile/muted-words'),
  useMutedWords: () => mockList as unknown as UseQueryResult<string[]>,
}));

const request = {
  id: 'r1',
  sender_id: 's1',
  display_name: 'Nina',
  age: 27,
  photo_path: null,
  verified: false,
  first_message: HELLO,
  profile_element: null,
  overlap_city: null,
  overlap_start: null,
  overlap_end: null,
  created_at: new Date().toISOString(),
} as unknown as IncomingRequestRow;

const show = () => render(<IncomingRequestCard request={request} />);

/** How many copies of the hello are in the tree (the card renders a hidden
 * measuring copy alongside the visible one when it shows the message). */
const copiesOfHello = () => screen.queryAllByText(HELLO).length;

beforeEach(() => {
  mockList.data = undefined;
  mockList.isLoading = true;
});

describe('while the reader’s list is still being fetched', () => {
  it('does not put the first message on screen', () => {
    show();
    expect(copiesOfHello()).toBe(0);
  });

  it('and does not put the fold there either, because nothing has matched yet', () => {
    show();
    expect(screen.queryByText(/This uses a word on your list/)).toBeNull();
  });

  it('but leaves every answer the reader had, so waiting is never a decision', () => {
    show();
    expect(screen.getByLabelText('Report this message')).toBeTruthy();
    expect(screen.getByLabelText("View Nina's full profile")).toBeTruthy();
  });
});

describe('once the list has arrived', () => {
  it('folds a hello that uses one of the words, and still does not render it', () => {
    mockList.data = ['night market'];
    mockList.isLoading = false;
    show();
    expect(screen.getByText('This uses a word on your list: night market')).toBeTruthy();
    expect(copiesOfHello()).toBe(0);
  });

  it('shows a hello that uses none of them', () => {
    mockList.data = ['hook up'];
    mockList.isLoading = false;
    show();
    expect(copiesOfHello()).toBeGreaterThan(0);
  });
});

describe('when there is no list coming at all', () => {
  it('shows the hello rather than holding it behind a request that will not land', () => {
    mockList.data = undefined;
    mockList.isLoading = false;
    show();
    expect(copiesOfHello()).toBeGreaterThan(0);
  });
});
