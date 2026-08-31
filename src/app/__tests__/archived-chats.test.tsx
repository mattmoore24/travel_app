import { render, screen } from '@testing-library/react-native';

import ArchivedChatsScreen from '@/app/archived-chats';
import { ChatRowSkeleton } from '@/components/ui/skeleton';
import type { ChatListRow } from '@/lib/database.types';

/**
 * The archive's three loading states, rendered. What is pinned here is the
 * failure load-error.tsx was written to end: line 17 used to destructure the
 * query's data away, so a person with six archived conversations who opened
 * this screen offline was told "Nothing archived." — for a chat archive the
 * most alarming possible wrong answer — and the same sentence flashed on
 * every cold open because nothing gated it on isSuccess.
 */

// jest.mock factories are hoisted above every other binding, so the state
// they close over has to be named mock* to be allowed through.
const mockQuery = {
  data: undefined as ChatListRow[] | undefined,
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
  useMyChats: (archived?: boolean) => {
    // The screen must ask for the ARCHIVED list, not the inbox.
    expect(archived).toBe(true);
    return mockQuery;
  },
}));

jest.mock('@/features/rooms/hooks', () => ({
  useChatPref: () => ({ mutate: jest.fn(), isPending: false }),
}));

// ChatRow signs photo URLs against two different buckets; nothing rendered
// here has a photo, so both hooks answer empty.
jest.mock('@/features/business/hooks', () => ({
  useIsPlaceChat: () => false,
}));
jest.mock('@/features/business/photo-url', () => ({
  useBusinessPhotoUrl: () => ({ data: null }),
}));
jest.mock('@/features/profile/hooks', () => ({
  usePhotoUrl: () => ({ data: null }),
}));

// A subpath import, so the jest.setup.js gesture-handler stub does not cover
// it. The swipe itself is not under test — only that a row wrapped in one
// renders at all, so the stub hands back its children. (React 19 passes
// `ref` as an ordinary prop, so no forwardRef is needed.)
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));

const row = (over: Partial<ChatListRow> = {}): ChatListRow => ({
  chat_id: 'chat-1',
  kind: 'direct',
  chat_status: 'active',
  title: 'Maya',
  other_user_id: 'user-2',
  photo_path: null,
  first_message: 'Hey, Lisbon next week?',
  first_message_sender_id: 'user-2',
  last_message: 'See you at the miradouro',
  last_message_at: '2026-08-20T18:00:00Z',
  member_count: null,
  pinned: false,
  muted: false,
  archived: true,
  expires_at: null,
  created_at: '2026-08-01T12:00:00Z',
  my_role: null,
  unread_count: 0,
  first_message_element: null,
  ...over,
});

beforeEach(() => {
  mockQuery.data = undefined;
  mockQuery.isPending = false;
  mockQuery.isError = false;
  mockQuery.isSuccess = false;
  mockQuery.error = null;
});

describe('the archive while loading', () => {
  it('shows skeletons, never the empty sentence', () => {
    mockQuery.isPending = true;
    render(<ArchivedChatsScreen />);
    expect(screen.UNSAFE_getAllByType(ChatRowSkeleton)).toHaveLength(3);
    expect(screen.queryByText('Nothing archived yet')).toBeNull();
  });
});

describe('the archive when the fetch fails', () => {
  it('says so and offers a retry, never the empty sentence', () => {
    mockQuery.isError = true;
    mockQuery.error = new Error('offline');
    render(<ArchivedChatsScreen />);
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText('Nothing archived yet')).toBeNull();
  });
});

describe('the archive on success', () => {
  it('says "Nothing archived yet" only for a genuinely empty archive', () => {
    mockQuery.isSuccess = true;
    mockQuery.data = [];
    render(<ArchivedChatsScreen />);
    // The EmptyState shape every list shares now: a title and a body.
    expect(screen.getByText('Nothing archived yet')).toBeTruthy();
  });

  it('draws each conversation as the inbox row, name and preview included', () => {
    mockQuery.isSuccess = true;
    mockQuery.data = [
      row(),
      row({ chat_id: 'chat-2', title: 'Maestro crew', kind: 'room', last_message: 'Rooftop at 9' }),
    ];
    render(<ArchivedChatsScreen />);
    expect(screen.getByText('Maya')).toBeTruthy();
    expect(screen.getByText('See you at the miradouro')).toBeTruthy();
    expect(screen.getByText('Maestro crew')).toBeTruthy();
    expect(screen.queryByText('Nothing archived yet')).toBeNull();
  });
});
