import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import AddToGroupScreen from '@/app/add-to-group/[userId]';
import { ChatRowSkeleton } from '@/components/ui/skeleton';
import type { ChatListRow } from '@/lib/database.types';

/**
 * Add somebody to a group: the list of your groups has three states before
 * it has rows, and the screen used to answer all three with "No groups yet".
 * The chats were destructured to `[]`, so somebody who runs three groups
 * was told they had none for the length of the round trip, and again for
 * good when the fetch failed. Skeleton before words; the empty sentence only
 * on success.
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
  useLocalSearchParams: () => ({ userId: 'u2', name: 'Ana' }),
}));

jest.mock('@/features/matching/hooks', () => ({
  useMyChats: () => mockQuery,
}));

jest.mock('@/features/groups/api', () => ({
  addToGroup: jest.fn(),
}));

const group = (over: Partial<ChatListRow> = {}): ChatListRow => ({
  chat_id: 'g1',
  kind: 'room',
  chat_status: 'active',
  title: 'Hostel crew',
  other_user_id: null,
  photo_path: null,
  first_message: null,
  first_message_sender_id: null,
  last_message: null,
  last_message_at: null,
  member_count: 4,
  pinned: false,
  muted: false,
  archived: false,
  expires_at: null,
  created_at: '2026-08-01T12:00:00Z',
  my_role: 'admin',
  unread_count: 0,
  first_message_element: null,
  plan_date: null,
  public_preview: null,
  ...over,
});

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AddToGroupScreen />
    </QueryClientProvider>
  );

beforeEach(() => {
  mockQuery.data = undefined;
  mockQuery.isPending = false;
  mockQuery.isError = false;
  mockQuery.isSuccess = false;
  mockQuery.error = null;
});

describe('while the groups are on their way', () => {
  it('draws two rows of shape, never the empty sentence', () => {
    mockQuery.isPending = true;
    show();
    expect(screen.UNSAFE_getAllByType(ChatRowSkeleton)).toHaveLength(2);
    expect(screen.queryByText('No groups yet')).toBeNull();
  });
});

describe('when the fetch fails', () => {
  it('says so and offers a retry, never the empty sentence', () => {
    mockQuery.isError = true;
    mockQuery.error = new Error('offline');
    show();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText('No groups yet')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(ChatRowSkeleton)).toHaveLength(0);
  });
});

describe('on success', () => {
  it('says "No groups yet" only for somebody who genuinely runs none', () => {
    mockQuery.isSuccess = true;
    mockQuery.data = [];
    show();
    expect(screen.getByText('No groups yet')).toBeTruthy();
  });

  it('lists the groups, and no shape', () => {
    mockQuery.isSuccess = true;
    mockQuery.data = [group()];
    show();
    expect(screen.getByLabelText('Add to Hostel crew')).toBeTruthy();
    expect(screen.queryByText('No groups yet')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(ChatRowSkeleton)).toHaveLength(0);
  });
});
