import { render, screen, within } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';

import PlaceScreen from '@/app/place/[id]';
import { RemoteImage } from '@/components/ui/remote-image';
import { Skeleton } from '@/components/ui/skeleton';
import type { BusinessDetailRow } from '@/lib/database.types';

/**
 * Every photo on the business page, while it loads.
 *
 * The page's PlaceImage drew its `fallback` whenever there was no URL yet,
 * so a cover on its way looked exactly like a business without one: the
 * category glyph, for the whole of the signing round trip, on the hero. The
 * post photo and the strip drew a sunken rectangle with no graphic at all.
 * One frame now tells "still coming" from "no photo": the glyph is for the
 * true no-photo case only, and the pulse stands in until the bytes land.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: 'biz-1' }),
  Link: () => null,
  Stack: { Screen: () => null },
}));

// expo-image as a host View that keeps the Image's own props, so `source`
// is readable off the rendered element.
jest.mock('expo-image', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { View } = require('react-native');
  const MockImage = (props: object) =>
    React.createElement(View, { testID: 'expo-image', ...props });
  return { __esModule: true, Image: MockImage };
});

const mockDetail = {
  data: null as BusinessDetailRow | null,
  isPending: false,
  isError: false,
  error: null as unknown,
  isRefetching: false,
  refetch: jest.fn(),
};
// One signing query stands in for every path on the page; the cache key is
// what tells the frames apart, and it comes from the path, not the URL.
const mockCover = { data: undefined as string | undefined, isError: false };

jest.mock('@/features/business/hooks', () => ({
  useBusinessDetail: () => mockDetail,
  useOwnBusiness: () => ({ data: null, isPending: true, fetchStatus: 'idle' }),
  useRatingSummary: () => ({
    data: null,
    isSuccess: true,
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/features/guest/hooks', () => ({ useIsGuest: () => false }));
jest.mock('@/features/pins/hooks', () => ({
  useCity: () => ({ data: null }),
  useCreatePin: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/features/matching/hooks', () => ({ useMyChats: () => ({ data: [] }) }));
jest.mock('@/features/business/photo-url', () => ({ useBusinessPhotoUrl: () => mockCover }));
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));
jest.mock('@/components/ui/sign-up-gate', () => ({ SignUpGate: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

const COVER = 'biz-1/cover.jpg';
const SECOND = 'biz-1/second.jpg';
const POST = 'biz-1/post.jpg';
const SIGNED = 'https://x.supabase.co/sign/one?token=1';

const place = (over: Partial<BusinessDetailRow> = {}): BusinessDetailRow => ({
  id: 'biz-1',
  chat_id: null,
  city_id: 1,
  name: 'Once Again Hostel',
  category: 'hostel',
  description: null,
  place_label: null,
  address: null,
  hours_note: null,
  website_url: null,
  lat: 13.75,
  lng: 100.5,
  verified: false,
  claimed: true,
  member_count: 0,
  photos: [
    { id: 'p1', storage_path: COVER },
    { id: 'p2', storage_path: SECOND },
  ],
  links: [],
  hours: [],
  posts: [
    {
      id: 'post-1',
      title: 'Quiz night',
      body: null,
      photo_path: POST,
      photo_state: 'ready',
      happens_at: null,
      ends_at: null,
    },
  ],
  ...over,
});

const frames = () => screen.UNSAFE_queryAllByType(RemoteImage);
const skeletons = () => screen.UNSAFE_queryAllByType(Skeleton);
const images = () => screen.UNSAFE_queryAllByType(Image);
/** The hero is the first frame on the page, and the one with a fallback. */
const hero = () => frames()[0];

beforeEach(() => {
  mockDetail.data = place();
  mockCover.data = undefined;
  mockCover.isError = false;
});

describe('while the URLs are being signed', () => {
  it('pulses in the hero, the post photo and the strip, and draws no glyph', () => {
    render(<PlaceScreen />);
    // Hero, one post photo, one strip photo (the cover is not repeated).
    expect(frames()).toHaveLength(3);
    for (const frame of frames()) {
      expect(frame.props).toMatchObject({ source: null, pending: true });
    }
    expect(skeletons()).toHaveLength(3);
    expect(images()).toHaveLength(0);
    // The category glyph is the hero's fallback and it stays off the frame:
    // a loading cover is not a missing one.
    expect(hero().props.fallback).toBeTruthy();
    expect(within(hero()).UNSAFE_queryAllByType(SymbolView)).toHaveLength(0);
  });
});

describe('once the URLs are in', () => {
  it('renders one Image per photo, each keyed on its own storage path', () => {
    mockCover.data = SIGNED;
    render(<PlaceScreen />);
    expect(images()).toHaveLength(3);
    const keys = images().map((image) => image.props.source.cacheKey);
    expect([...keys].sort()).toEqual([COVER, POST, SECOND].sort());
    // Still pulsing underneath until each Image reports its bytes.
    expect(skeletons()).toHaveLength(3);
  });
});

describe('a business with no photo', () => {
  it('draws the category glyph in the hero, and no pulse', () => {
    mockDetail.data = place({ photos: [], posts: [] });
    render(<PlaceScreen />);
    expect(frames()).toHaveLength(1);
    expect(hero().props).toMatchObject({ source: null, pending: false });
    expect(within(hero()).UNSAFE_queryAllByType(SymbolView)).toHaveLength(1);
    expect(skeletons()).toHaveLength(0);
    expect(images()).toHaveLength(0);
  });
});
