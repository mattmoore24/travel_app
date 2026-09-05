import { render, screen } from '@testing-library/react-native';

import FirstMessagesScreen from '@/app/first-messages';
import { source } from '@/lib/__tests__/source';
import type { IncomingRequestRow } from '@/lib/database.types';

/**
 * The waiting-hellos page, rendered, for the one thing ds-stack-header
 * changes about it: the title moved OUT of the body and ONTO the route. Both
 * halves are pinned together, the same way archived-chats.test.tsx pins the
 * archive, because either half on its own is the wrong screen. A title in
 * both places is the two-storey chrome the package deletes (a chevron on a
 * row of its own, the word again underneath); a title in neither is a page
 * with no name.
 */

// jest.mock factories are hoisted above every other binding, so the state
// they close over has to be named mock* to be allowed through.
const mockQuery = {
  data: undefined as IncomingRequestRow[] | undefined,
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null as unknown,
  refetch: jest.fn(),
};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/features/matching/hooks', () => ({
  useIncomingRequests: () => mockQuery,
}));

jest.mock('@/features/chat/use-announce', () => ({
  useAnnounce: jest.fn(),
}));

// The card is the inbox's own (features/matching/incoming-request-card) and
// has its own tests. Here it only has to stand in for one hello.
jest.mock('@/features/matching/incoming-request-card', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    IncomingRequestCard: ({ request }: { request: { id: string } }) =>
      React.createElement(Text, null, `card ${request.id}`),
  };
});

const hello = (id: string): IncomingRequestRow =>
  ({ id, sender_id: `sender-${id}` }) as unknown as IncomingRequestRow;

beforeEach(() => {
  mockQuery.data = undefined;
  mockQuery.isPending = false;
  mockQuery.isError = false;
  mockQuery.isSuccess = false;
  mockQuery.error = null;
});

describe('the header', () => {
  it('names the screen once, in the header row that was carrying only a chevron', () => {
    mockQuery.isSuccess = true;
    mockQuery.data = [hello('a'), hello('b')];
    render(<FirstMessagesScreen />);
    // The body no longer draws the title...
    expect(screen.queryByText('Waiting on you')).toBeNull();
    // ...and it is still the same page: the explanation under where the
    // title was, and the cards.
    expect(
      screen.getByText('Answer one and the chat opens. Decline and they are never told.')
    ).toBeTruthy();
    expect(screen.getByText('card a')).toBeTruthy();
    expect(screen.getByText('card b')).toBeTruthy();
    // ...because the title is ON the route, in the words the inbox section
    // that opens this page uses.
    expect(source('src/app/_layout.tsx')).toMatch(
      /name="first-messages"[\s\S]{0,160}headerTitle: 'Waiting on you'/
    );
  });

  it('keeps the empty sentence in the body, which is a state and not a title', () => {
    mockQuery.isSuccess = true;
    mockQuery.data = [];
    render(<FirstMessagesScreen />);
    expect(screen.getByText('Nothing waiting on you')).toBeTruthy();
    // Exact match: "Nothing waiting on you" must not be what satisfies a
    // check for the title, and the title must not be what satisfies this.
    expect(screen.queryByText('Waiting on you')).toBeNull();
  });
});
