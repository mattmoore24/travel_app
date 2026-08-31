import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import TravelersScreen from '@/app/(tabs)/travelers';

/**
 * One travelers_viewed per view, always carrying the guest flag.
 *
 * The guest branch used to fire its own untagged copy on top of the parent's,
 * so every guest counted twice — and because the parent's event had no
 * `guest` property, filtering `guest != true` did not remove guests from
 * matching DAU: the untagged copy still counted.
 */

const mockCapture = jest.fn();
jest.mock('@/lib/analytics', () => ({
  analytics: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

let mockIsGuest = true;
jest.mock('@/features/guest/hooks', () => ({
  useIsGuest: () => mockIsGuest,
  useIsSignedOut: () => mockIsGuest,
  useFeaturedTraveler: () => ({ data: null, isPending: false, isError: false }),
  useFeaturedPhoto: () => ({ data: null }),
  useMapPins: () => ({ data: [] }),
}));

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useFocusEffect: () => {},
}));

jest.mock('@/features/pins/hooks', () => ({
  useLaunchCities: () => ({ data: [], isError: false }),
}));

jest.mock('@/features/matching/hooks', () => ({
  useMatches: () => ({ data: [], isError: false, refetch: jest.fn() }),
  useMyChats: () => ({ data: [] }),
  useSentRequests: () => ({ data: [] }),
  useDailySpotlight: () => ({ data: null }),
  useFirstMessageBudget: () => ({ data: { used: 0, allowed: 8 } }),
}));

jest.mock('@/features/trips/hooks', () => ({
  useMyTrips: () => ({ data: [], isError: false, refetch: jest.fn() }),
  useTravelerTrips: () => ({ data: [] }),
}));

jest.mock('@/features/profile/hooks', () => ({
  useOwnVisibility: () => ({ data: 'everyone' }),
  usePublicProfile: () => ({ data: null }),
  usePublicPhotos: () => ({ data: [] }),
  useProfilePrompts: () => ({ data: [] }),
  useProfilePriorities: () => ({ data: [] }),
}));

// The next two faces are fetched a card early, which needs a live query
// client this test has no reason to stand up. Not what it is about.
jest.mock('@/features/matching/prefetch', () => ({
  useNextTravelersPrefetch: () => {},
}));

// The card's overflow can block the person on screen, which reaches for the
// viewer's own id. Not what this test is about.
jest.mock('@/features/chat/hooks', () => ({
  useBlockUser: () => ({ mutate: jest.fn() }),
}));

// Chrome that carries its own data needs: not what this test is about.
jest.mock('@/components/ui/avatar-button', () => ({ AvatarButton: () => null }));
jest.mock('@/components/ui/sign-up-gate', () => ({ SignUpGate: () => null }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TravelersScreen />
    </SafeAreaProvider>
  );

beforeEach(() => {
  mockCapture.mockClear();
});

it('a guest view fires exactly one travelers_viewed, tagged guest', () => {
  mockIsGuest = true;
  show();
  const views = mockCapture.mock.calls.filter(([event]) => event === 'travelers_viewed');
  expect(views).toEqual([['travelers_viewed', { guest: true }]]);
});

it('a signed-in view fires exactly one, tagged not-guest', () => {
  mockIsGuest = false;
  show();
  const views = mockCapture.mock.calls.filter(([event]) => event === 'travelers_viewed');
  expect(views).toEqual([['travelers_viewed', { guest: false }]]);
});
