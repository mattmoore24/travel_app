import { render, screen } from '@testing-library/react-native';

import PlaceScreen from '@/app/place/[id]';
import type { BusinessDetailRow } from '@/lib/database.types';

/**
 * The business page's header title, which cannot be set in _layout because
 * the name does not exist until the detail query resolves. So the screen
 * sets it from inside its loaded branch (`<Stack.Screen options>` reaches
 * the navigator through setOptions), and this pins the two things that
 * follow from that: nothing is set while there is no name to set, and once
 * there is one it is the name — while the hero keeps its own copy, because
 * the hero's copy is the one with the verified seal beside it.
 */

// Every options object the screen hands the navigator, in render order.
// Named mock* so the hoisted factory below may close over it.
const mockTitles: unknown[] = [];

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: 'biz-1' }),
  Link: () => null,
  Stack: {
    Screen: ({ options }: { options?: { headerTitle?: unknown } }) => {
      mockTitles.push(options?.headerTitle);
      return null;
    },
  },
}));

const mockDetail = {
  data: null as BusinessDetailRow | null,
  isPending: true,
  isError: false,
  error: null as unknown,
  refetch: jest.fn(),
};

jest.mock('@/features/business/hooks', () => ({
  useBusinessDetail: () => mockDetail,
  // A traveler, not an owner: `fetchStatus: 'idle'` is the disabled-query
  // shape the screen reads as "nobody is going to ask".
  useOwnBusiness: () => ({ data: null, isPending: true, fetchStatus: 'idle' }),
  useRatingSummary: () => ({ data: null, isSuccess: true, refetch: jest.fn() }),
}));
jest.mock('@/features/guest/hooks', () => ({ useIsGuest: () => false }));
// 'Plan to go' reads the business's city row by id for the form's city name
// and clock (any city since 2026-09-05, not only a launch one); no row here
// means no button, which this file does not look at. Mounted without a
// QueryClient, so the real hook cannot run.
jest.mock('@/features/pins/hooks', () => ({
  useCity: () => ({ data: null }),
  useCreatePin: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/features/matching/hooks', () => ({ useMyChats: () => ({ data: [] }) }));
jest.mock('@/features/business/photo-url', () => ({ useBusinessPhotoUrl: () => ({ data: null }) }));
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));
jest.mock('@/components/ui/sign-up-gate', () => ({ SignUpGate: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

const NAME = 'Once Again Hostel';

const place = (over: Partial<BusinessDetailRow> = {}): BusinessDetailRow => ({
  id: 'biz-1',
  chat_id: null,
  city_id: 1,
  name: NAME,
  category: 'hostel',
  description: null,
  place_label: null,
  address: null,
  hours_note: null,
  website_url: null,
  lat: 13.75,
  lng: 100.5,
  verified: true,
  claimed: true,
  member_count: 0,
  photos: [],
  links: [],
  hours: [],
  posts: [],
  ...over,
});

beforeEach(() => {
  mockTitles.length = 0;
  mockDetail.data = null;
  mockDetail.isPending = true;
  mockDetail.isError = false;
  mockDetail.error = null;
});

describe('the business page header', () => {
  it('sets nothing while the name is still loading', () => {
    // The layout's `headerTitle: ''` stands on its own under the skeleton:
    // there is no name yet, so the screen must not reach for the bar.
    render(<PlaceScreen />);
    expect(mockTitles).toEqual([]);
    expect(screen.queryByText(NAME)).toBeNull();
  });

  it('sets nothing on a failed fetch either', () => {
    mockDetail.isPending = false;
    mockDetail.isError = true;
    mockDetail.error = new Error('offline');
    render(<PlaceScreen />);
    expect(mockTitles).toEqual([]);
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('puts the name in the bar once the query lands, and keeps it on the hero beside the seal', () => {
    mockDetail.isPending = false;
    mockDetail.data = place({ verified: true });
    render(<PlaceScreen />);
    // A string, not a render callback: the repo's one mechanism for a title
    // that arrives with a query (profile/[userId]) is a string through
    // setOptions, and the native bar paints it in NavigationTheme's text.
    expect(mockTitles).toContain(NAME);
    expect(mockTitles.every((t) => t === NAME)).toBe(true);
    // Exactly one copy in the body — the hero — never a second one.
    expect(screen.getAllByText(NAME)).toHaveLength(1);
    // The hero's copy is the one that carries the check.
    expect(screen.getByLabelText('Verified business')).toBeTruthy();
  });
});
