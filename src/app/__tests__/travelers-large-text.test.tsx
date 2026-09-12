import { render, screen, within } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import TravelersScreen from '@/app/(tabs)/travelers';
import { Skeleton } from '@/components/ui/skeleton';
import { FontCap } from '@/constants/theme';

/**
 * Travelers keeps its viewport at the accessibility sizes.
 *
 * The header above the page is pinned, so every line in it is paid for by
 * the card's viewport. At AX5 the header alone was some 250pt and the
 * docked bar another 140, which left the traveler a thin strip between
 * them. The count line is a sentence and stays uncapped; what gives is
 * where it stands: from 2x up it scrolls with the page. The two control
 * labels in the bar and the header (Next, the radius dial) take the
 * control cap instead.
 *
 * And the shape while the queries answer is one shape for both audiences.
 * The guest branch used to render a blank ThemedView for the whole retry
 * window on the screen a first-time visitor opens second.
 */

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));

let mockIsGuest = false;
let mockCitiesPending = false;
let mockNoCities = false;
jest.mock('@/features/guest/hooks', () => ({
  useIsGuest: () => mockIsGuest,
  useIsSignedOut: () => mockIsGuest,
  useFeaturedTraveler: () => ({
    data: null,
    isPending: true,
    isError: false,
    fetchStatus: 'idle',
  }),
  useFeaturedPhoto: () => ({ data: undefined, isError: false, fetchStatus: 'idle' }),
  featuredPhotoFor: () => null,
  useMapPins: () => ({ data: [] }),
}));

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() },
  useFocusEffect: () => {},
}));

jest.mock('@/features/pins/hooks', () => ({
  useFeaturedCities: () =>
    mockCitiesPending
      ? { data: undefined, isPending: true, isError: false }
      : {
          data: mockNoCities ? [] : [{ city_id: 1, cities: { name: 'Lisbon' } }],
          isPending: false,
          isSuccess: true,
          isError: false,
        },
}));

const MATCH = {
  trip_id: 't1',
  user_id: 'u1',
  display_name: 'Ana',
  age: 29,
  bio: 'Here for the tiles.',
  occupation: null,
  gender: null,
  verified: false,
  languages: ['en'],
  photo_path: null,
  city_name: 'Bangkok',
  my_city_name: 'Bangkok',
  overlap_start: '2026-09-14',
  overlap_end: '2026-09-18',
};

let mockTripsPending = false;
jest.mock('@/features/trips/hooks', () => ({
  useMyTrips: () =>
    mockTripsPending
      ? { data: undefined, isPending: true, isError: false, refetch: jest.fn() }
      : {
          data: [
            {
              id: 't1',
              cities: { name: 'Bangkok' },
              start_date: '2026-09-12',
              end_date: '2026-09-20',
              approximate: false,
            },
          ],
          isPending: false,
          isSuccess: true,
          isError: false,
          refetch: jest.fn(),
        },
  useTravelerTrips: () => ({ data: [] }),
}));

jest.mock('@/features/matching/hooks', () => ({
  useMatches: () => ({
    data: [MATCH],
    isPending: false,
    isSuccess: true,
    isError: false,
    isFetching: false,
    isPlaceholderData: false,
    refetch: jest.fn(),
  }),
  useSetTravelersRadius: () => ({ set: jest.fn(), isPending: false }),
  useMyChats: () => ({ data: [] }),
  useSentRequests: () => ({ data: [] }),
  useJustSentHello: Object.assign(() => null, { getState: () => ({ clear: jest.fn() }) }),
  useDailySpotlight: () => ({ data: null }),
  useFirstMessageBudget: () => ({ data: { used: 0, allowed: 8 } }),
}));

jest.mock('@/features/profile/hooks', () => ({
  useOwnProfile: () => ({ data: { travelers_radius_km: 25, languages: ['en'] } }),
  useOwnUserId: () => 'me',
  useOwnVisibility: () => ({ data: 'everyone' }),
  usePublicProfile: () => ({ data: null }),
  usePublicPhotos: () => ({ data: [] }),
  useProfilePrompts: () => ({ data: [], isSuccess: true }),
  useProfilePriorities: () => ({ data: [] }),
}));

jest.mock('@/features/matching/prefetch', () => ({ useNextTravelersPrefetch: () => {} }));
jest.mock('@/features/chat/hooks', () => ({ useBlockUser: () => ({ mutate: jest.fn() }) }));
jest.mock('@/components/ui/avatar-button', () => ({ AvatarButton: () => null }));
jest.mock('@/components/ui/sign-up-gate', () => ({ SignUpGate: () => null }));
// The page's body is somebody else's component and forty hooks deep; the
// question here is what stands around it.
jest.mock('@/features/profile/profile-view', () => ({ ProfileView: () => null }));

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

/** The page's scroller: the one with a pull to refresh on it. */
const page = () =>
  screen.UNSAFE_getAllByType(ScrollView).find((node) => node.props.refreshControl != null)!;

beforeEach(() => {
  mockFontScale = 1;
  mockIsGuest = false;
  mockCitiesPending = false;
  mockNoCities = false;
  mockTripsPending = false;
});

describe('the count line', () => {
  it('stands in the pinned header at the default size', () => {
    show();
    expect(screen.getByText('Last one for now')).toBeTruthy();
    expect(within(page()).queryByText('Last one for now')).toBeNull();
  });

  it('scrolls with the page from 2x up, so the card keeps its viewport', () => {
    mockFontScale = 2;
    show();
    expect(within(page()).getByText('Last one for now')).toBeTruthy();
    // Once, not twice: the header gives it up.
    expect(screen.getAllByText('Last one for now')).toHaveLength(1);
  });

  it('is never capped: it is a sentence, and where it stands is what gives', () => {
    mockFontScale = 3.1;
    show();
    expect(screen.getByText('Last one for now').props.maxFontSizeMultiplier).toBeUndefined();
  });
});

describe('the control labels around the page', () => {
  it('cap Next and the radius dial at the control cap', () => {
    mockFontScale = 3.1;
    show();
    expect(screen.getByText('Next').props.maxFontSizeMultiplier).toBe(FontCap.control);
    // The dial prints in the locale's unit ("Within 16 mi" on this runner).
    expect(screen.getByText(/^Within /).props.maxFontSizeMultiplier).toBe(FontCap.control);
  });
});

describe('the shape while the queries answer', () => {
  it('is a skeleton for a signed-in reader', () => {
    mockTripsPending = true;
    show();
    expect(screen.UNSAFE_getAllByType(Skeleton).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Last one for now')).toBeNull();
  });

  it('is the same skeleton for a guest, never a blank view', () => {
    mockIsGuest = true;
    mockCitiesPending = true;
    show();
    expect(screen.UNSAFE_getAllByType(Skeleton).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Travelers')).toBeNull();
  });

  it('settles a guest whose rail has no city rather than waiting for ever', () => {
    // The traveler query is disabled without a city, which React Query
    // reports as pending for ever; the page falls through to its words.
    mockIsGuest = true;
    mockNoCities = true;
    show();
    expect(screen.getByText('Travelers')).toBeTruthy();
    expect(screen.getByText('Nobody in town this week.')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Skeleton)).toHaveLength(0);
  });

  it('keeps a guest with a city on the skeleton while their faces are asked for', () => {
    // Enabled and not yet answered: still the skeleton, never the words.
    mockIsGuest = true;
    show();
    expect(screen.queryByText('Travelers')).toBeNull();
    expect(screen.UNSAFE_getAllByType(Skeleton).length).toBeGreaterThanOrEqual(4);
  });
});
