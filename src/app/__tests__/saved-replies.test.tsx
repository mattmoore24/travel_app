import { render, screen } from '@testing-library/react-native';

import SavedRepliesScreen from '@/app/saved-replies';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Quick replies: three fields over data that has not arrived is three
 * fields saying "you have none". The saved bodies then popped into the
 * boxes over whatever was being read. The fields wait for the answer; until
 * then they are shapes.
 */

const mockBusiness = { data: undefined as { id: string } | undefined, isPending: true };
const mockReplies = {
  data: undefined as { position: number; body: string }[] | undefined,
  isPending: true,
  isError: false,
  error: null as unknown,
  fetchStatus: 'idle' as 'idle' | 'fetching',
  refetch: jest.fn(),
};

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock('@/features/business/hooks', () => ({
  useOwnBusiness: () => mockBusiness,
  useSavedReplies: () => mockReplies,
  useSetSavedReply: () => ({ mutate: jest.fn(), isPending: false }),
}));

beforeEach(() => {
  mockBusiness.data = undefined;
  mockBusiness.isPending = true;
  mockReplies.data = undefined;
  mockReplies.isPending = true;
  mockReplies.isError = false;
  mockReplies.error = null;
  mockReplies.fetchStatus = 'idle';
});

describe('before the replies are known', () => {
  it('draws three shapes while the business itself is still on its way', () => {
    // The replies query is disabled (idle) until the business id is known,
    // so the business half of the wait has to count too.
    render(<SavedRepliesScreen />);
    expect(screen.UNSAFE_getAllByType(Skeleton)).toHaveLength(3);
    expect(screen.queryByText('Reply 1')).toBeNull();
  });

  it('draws three shapes while the replies themselves are fetching', () => {
    mockBusiness.data = { id: 'b1' };
    mockBusiness.isPending = false;
    mockReplies.fetchStatus = 'fetching';
    render(<SavedRepliesScreen />);
    expect(screen.UNSAFE_getAllByType(Skeleton)).toHaveLength(3);
    expect(screen.queryByText('Reply 1')).toBeNull();
  });

  it('says so and offers a retry when they do not come', () => {
    mockBusiness.data = { id: 'b1' };
    mockBusiness.isPending = false;
    mockReplies.isPending = false;
    mockReplies.isError = true;
    mockReplies.error = new Error('offline');
    render(<SavedRepliesScreen />);
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText('Reply 1')).toBeNull();
  });
});

describe('once they are known', () => {
  it('opens the three fields with the saved bodies in them', () => {
    mockBusiness.data = { id: 'b1' };
    mockBusiness.isPending = false;
    mockReplies.isPending = false;
    mockReplies.data = [{ position: 0, body: 'Beds tonight, yes.' }];
    render(<SavedRepliesScreen />);
    expect(screen.getByText('Reply 1')).toBeTruthy();
    expect(screen.getByText('Reply 3')).toBeTruthy();
    expect(screen.getByDisplayValue('Beds tonight, yes.')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Skeleton)).toHaveLength(0);
  });
});
