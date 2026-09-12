import { act, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { RemoteImage } from '@/components/ui/remote-image';
import { Skeleton } from '@/components/ui/skeleton';
import { PlaceGlyph } from '@/features/business/business-marker';
import { PlaceSheet } from '@/features/business/place-sheet';
import type { BusinessDetailRow } from '@/lib/database.types';

/**
 * The cover on the map's place sheet, through both halves of its wait.
 *
 * A business photo loads in two phases: the signed URL is fetched, then the
 * bytes are downloaded. The sheet drew a Skeleton for the first and handed
 * over to a transparent Image for the second, so the card carried a 3:2 hole
 * between the URL arriving and the bytes arriving, on the map's most-tapped
 * surface. One frame now keeps the pulse under the picture until the bytes
 * land. The category chip stands in only when there is no cover at all, or
 * when the signing itself failed, which is the one case that gives the
 * space back.
 */

// PlaceGlyph's module reaches react-native-maps for its Marker half, whose
// native module does not exist under jest.
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(RN.View, null, children),
    Marker: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(RN.View, null, children),
    Polygon: () => null,
    Circle: () => null,
    PROVIDER_DEFAULT: 'default',
  };
});

// expo-image as a host View that keeps the Image's own props, so the test
// can read `source` off it and fire `onLoad` the way the native view would.
jest.mock('expo-image', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { View } = require('react-native');
  const MockImage = (props: object) =>
    React.createElement(View, { testID: 'expo-image', ...props });
  return { __esModule: true, Image: MockImage };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
}));
// The Sheet is chrome this test does not exercise; render straight through.
jest.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: unknown }) => children,
  leavingSheet: () => (go: () => void) => go(),
}));
jest.mock('@/components/ui/sign-up-gate', () => ({ SignUpGate: () => null }));
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));

const mockDetail = {
  data: null as BusinessDetailRow | null,
  isPending: false,
  isError: false,
  error: null as unknown,
  refetch: jest.fn(),
};
// The signing query, in the three states the sheet distinguishes.
const mockCover = { data: undefined as string | undefined, isError: false };

jest.mock('@/features/business/hooks', () => ({
  useBusinessDetail: () => mockDetail,
  // A traveler: `fetchStatus: 'idle'` is the disabled-query shape the sheet
  // reads as "nobody is going to ask".
  useOwnBusiness: () => ({ data: null, isPending: true, fetchStatus: 'idle' }),
  useRatingSummary: () => ({ data: null, isSuccess: true }),
}));
jest.mock('@/features/guest/hooks', () => ({ useIsGuest: () => false }));
jest.mock('@/features/matching/hooks', () => ({ useMyChats: () => ({ data: [] }) }));
jest.mock('@/features/business/photo-url', () => ({ useBusinessPhotoUrl: () => mockCover }));

const COVER_PATH = 'biz-1/cover.jpg';
const SIGNED = 'https://x.supabase.co/sign/biz-1/cover.jpg?token=1';

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
  photos: [{ id: 'p1', storage_path: COVER_PATH }],
  links: [],
  hours: [],
  posts: [],
  ...over,
});

const show = () => render(<PlaceSheet businessId="biz-1" onClose={jest.fn()} />);
const frames = () => screen.UNSAFE_queryAllByType(RemoteImage);
const skeletons = () => screen.UNSAFE_queryAllByType(Skeleton);
const chips = () => screen.UNSAFE_queryAllByType(PlaceGlyph);
const images = () => screen.UNSAFE_queryAllByType(Image);

beforeEach(() => {
  mockDetail.data = place();
  mockCover.data = undefined;
  mockCover.isError = false;
});

describe('while the cover is being signed', () => {
  it('pulses in the frame and keeps the category chip off the card', () => {
    show();
    expect(frames()).toHaveLength(1);
    expect(frames()[0].props).toMatchObject({ source: null, pending: true });
    // One pulse: the cover. The rating line has its answer.
    expect(skeletons()).toHaveLength(1);
    expect(chips()).toHaveLength(0);
    expect(images()).toHaveLength(0);
  });
});

describe('while the bytes are downloading', () => {
  it('keeps the pulse under exactly one Image, keyed on the storage path', () => {
    mockCover.data = SIGNED;
    show();
    expect(images()).toHaveLength(1);
    expect(images()[0].props.source).toEqual({ uri: SIGNED, cacheKey: COVER_PATH });
    expect(skeletons()).toHaveLength(1);
    expect(chips()).toHaveLength(0);
  });

  it('drops the pulse once they land', () => {
    mockCover.data = SIGNED;
    show();
    act(() => screen.getByTestId('expo-image').props.onLoad({ source: { uri: SIGNED } }));
    expect(skeletons()).toHaveLength(0);
    expect(images()).toHaveLength(1);
    expect(screen.getByLabelText('Photo of Once Again Hostel')).toBeTruthy();
  });
});

describe('when there is nothing to wait for', () => {
  it('gives the space back to the category chip when the signing failed', () => {
    mockCover.isError = true;
    show();
    expect(frames()).toHaveLength(0);
    expect(skeletons()).toHaveLength(0);
    expect(chips()).toHaveLength(1);
  });

  it('draws the chip, and no frame at all, for a business with no cover', () => {
    mockDetail.data = place({ photos: [] });
    show();
    expect(frames()).toHaveLength(0);
    expect(skeletons()).toHaveLength(0);
    expect(chips()).toHaveLength(1);
  });
});
