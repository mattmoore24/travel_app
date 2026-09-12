import { render, screen } from '@testing-library/react-native';
import { SymbolView } from 'expo-symbols';

import BusinessStorefrontScreen from '@/app/business-storefront';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The storefront check before its row.
 *
 * `latest` defaulted to null while the check query was in the air, so the
 * screen guessed "fresh listing": two camera tiles and "Take the wide shot",
 * which then flipped to "We're having a look" when the row landed. An owner
 * whose photos were already in the queue was invited to start over for the
 * length of a round trip. The frames' own shape stands there now, and the
 * button waits with them.
 */

const mockOwn = {
  data: null as { id: string; verified: boolean } | null,
  isPending: false,
  fetchStatus: 'idle' as 'idle' | 'fetching',
};
const mockCheck = {
  data: undefined as { status: string; reason: string | null } | null | undefined,
  isPending: true,
  fetchStatus: 'fetching' as 'idle' | 'fetching',
  dataUpdatedAt: 0,
};

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => false },
}));
jest.mock('@/features/business/hooks', () => ({
  useOwnBusiness: () => mockOwn,
  useLatestStorefrontCheck: () => mockCheck,
  useSubmitStorefront: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
    isSuccess: false,
    submittedAt: 0,
  }),
}));
jest.mock('@/lib/live-camera', () => ({ captureLivePhoto: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));
jest.mock('@/lib/haptics', () => ({
  haptics: { medium: jest.fn(), error: jest.fn(), success: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

const skeletons = () => screen.UNSAFE_queryAllByType(Skeleton);
// With no Close button (canGoBack is false) the only glyphs on the screen are
// the camera tiles' two.
const cameraTiles = () => screen.UNSAFE_queryAllByType(SymbolView);
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  mockOwn.data = { id: 'biz-1', verified: false };
  mockOwn.isPending = false;
  mockOwn.fetchStatus = 'idle';
  mockCheck.data = undefined;
  mockCheck.isPending = true;
  mockCheck.fetchStatus = 'fetching';
});

describe('while the check row is on its way', () => {
  it('draws the two frames as placeholders, never the camera tiles', () => {
    render(<BusinessStorefrontScreen />);
    expect(skeletons()).toHaveLength(2);
    for (const frame of skeletons()) {
      expect(frame.props).toMatchObject({ width: '100%', aspectRatio: 4 / 3 });
    }
    expect(cameraTiles()).toHaveLength(0);
  });

  it('holds the button until the row is known', () => {
    render(<BusinessStorefrontScreen />);
    expect(button('Take the wide shot').props.accessibilityState.disabled).toBe(true);
  });
});

describe('once the row is known', () => {
  it('offers the two shots to a listing with no check yet', () => {
    mockCheck.data = null;
    mockCheck.isPending = false;
    mockCheck.fetchStatus = 'idle';
    render(<BusinessStorefrontScreen />);
    expect(skeletons()).toHaveLength(0);
    expect(cameraTiles()).toHaveLength(2);
    expect(button('Take the wide shot').props.accessibilityState.disabled).toBe(false);
  });

  it('says so to a listing whose photos are already in the queue', () => {
    mockCheck.data = { status: 'pending', reason: null };
    mockCheck.isPending = false;
    mockCheck.fetchStatus = 'idle';
    render(<BusinessStorefrontScreen />);
    expect(screen.getByText("We're having a look")).toBeTruthy();
    expect(skeletons()).toHaveLength(0);
    expect(cameraTiles()).toHaveLength(0);
  });
});

describe('before the business itself is known', () => {
  it('still says it is finding the business rather than pulsing at nothing', () => {
    // A disabled check (no id yet) is not "waiting": it is never going to
    // ask, and the screen's own note covers this beat.
    mockOwn.data = null;
    mockCheck.fetchStatus = 'idle';
    render(<BusinessStorefrontScreen />);
    expect(screen.getByText('Finding your business.')).toBeTruthy();
    expect(skeletons()).toHaveLength(0);
  });
});
