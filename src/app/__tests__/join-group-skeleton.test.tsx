import { render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import JoinGroupScreen from '@/app/join-group/[token]';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The far end of an invite link is very often somebody's first launch, and
 * it used to be a blank screen for the whole round trip. The shape of the
 * page comes first; the group's own photo pulses in its frame until the
 * bytes land, rather than showing the "no photo" glyph while it signs.
 */

const mockPreview = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: true,
  isError: false,
  error: null as unknown,
  refetch: jest.fn(),
};
// What the chat-photo signer answers: undefined is "still signing".
let mockUrl: string | undefined = undefined;

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ token: 'tok-1' }),
}));

jest.mock('@/features/business/hooks', () => ({
  useIsBusiness: () => false,
}));

jest.mock('@/features/guest/hooks', () => ({
  useIsSignedOut: () => false,
}));

jest.mock('@/features/auth/store', () => ({
  useAuthStore: (select: (s: { inviteRemembered: () => void }) => unknown) =>
    select({ inviteRemembered: jest.fn() }),
}));

jest.mock('@/features/groups/hooks', () => ({
  useGroupInvitePreview: () => mockPreview,
  useJoinGroup: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/features/chat/hooks', () => ({
  useChatPhotoUrl: () => ({ data: mockUrl, isError: false }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <JoinGroupScreen />
    </SafeAreaProvider>
  );

const preview = () => ({
  chat_id: 'g1',
  name: 'Hostel crew',
  member_count: 4,
  photo_path: 'g1/cover.jpg',
  speaking: 'everyone',
  max_stay_until: null,
  closed: false,
  already_member: false,
});

beforeEach(() => {
  mockPreview.data = undefined;
  mockPreview.isPending = true;
  mockPreview.isError = false;
  mockPreview.error = null;
  mockUrl = undefined;
});

describe('while the invite is on its way', () => {
  it('draws the shape of the page, and nothing to press yet', () => {
    show();
    expect(screen.UNSAFE_getAllByType(Skeleton).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Join the group')).toBeNull();
    expect(screen.queryByText('This invite is not open')).toBeNull();
  });
});

describe('once the invite is known', () => {
  it('pulses the photo frame while the group photo is still being signed', () => {
    mockPreview.isPending = false;
    mockPreview.data = preview();
    show();
    expect(screen.getByText('Join the group')).toBeTruthy();
    // One pulse: the frame's own, in the 84pt tile. No Image yet, and no
    // "no photo" glyph over a photo that is on its way.
    expect(screen.UNSAFE_getAllByType(Skeleton)).toHaveLength(1);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('draws the photo once, keyed on its path', () => {
    mockPreview.isPending = false;
    mockPreview.data = preview();
    mockUrl = 'https://signed.example/g1/cover.jpg?token=1';
    show();
    const images = screen.UNSAFE_getAllByType(Image);
    expect(images).toHaveLength(1);
    expect(images[0].props.source.cacheKey).toBe('g1/cover.jpg');
  });
});
