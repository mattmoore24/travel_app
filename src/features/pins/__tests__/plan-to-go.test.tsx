import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import PlaceScreen from '@/app/place/[id]';
import { PinFormSheet, pinCategoryForBusiness } from '@/features/pins/pin-form-sheet';
import type { BusinessDetailRow } from '@/lib/database.types';

/**
 * 'Plan to go', end to end from the business page to the mutation.
 *
 * map-pins-link-to-a-business shipped the column and the server-side link
 * and no entry point: the deviation lived in a migration comment. These are
 * the assertions that say the page carries the button, the button opens the
 * form with the business already in it, and what the form sends names the
 * business by id rather than hoping the name matches. The database's own
 * guards are pgTAP's half (72_a_plan_names_its_business).
 */

// Typed with its argument, because the argument IS the assertion here.
const mockMutateAsync = jest.fn(async (_input: Record<string, unknown>) => ({ id: 'pin-1' }));

jest.mock('@/features/pins/hooks', () => ({
  useCreatePin: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  // The city the fixture business is filed under, read by id: since
  // 2026-09-05 that can be any city rather than a launch one, so the page
  // asks for the row itself, which carries the name and clock the form needs
  // and a business row does not.
  useCity: (cityId: number | null) => ({
    data:
      cityId === 1
        ? {
            id: 1,
            name: 'Lisbon',
            country_code: 'PT',
            country_name: 'Portugal',
            admin: null,
            lat: 38.7223,
            lng: -9.1393,
            population: 500_000,
            timezone: 'Europe/Lisbon',
          }
        : null,
  }),
}));
// The Sheet is chrome this test does not exercise; render straight through.
jest.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: unknown }) => children,
}));
// PinGlyph's module reaches react-native-maps, whose native module does not
// exist under jest.
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
const mockReverseGeocode = jest.fn(async () => []);
jest.mock('expo-location', () => ({
  reverseGeocodeAsync: () => mockReverseGeocode(),
}));

// The business page's own surroundings, the same set place-title.test.tsx
// mounts it with, plus a way to say who is looking.
const mockViewer = { guest: false, ownBusiness: null as { id: string } | null };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: 'biz-1' }),
  Link: () => null,
  Stack: { Screen: () => null },
}));
const mockDetail = {
  data: null as BusinessDetailRow | null,
  isPending: false,
  isError: false,
  error: null as unknown,
  isRefetching: false,
  refetch: jest.fn(),
};
jest.mock('@/features/business/hooks', () => ({
  useBusinessDetail: () => mockDetail,
  useOwnBusiness: () => ({ data: mockViewer.ownBusiness, isPending: false, fetchStatus: 'idle' }),
  useRatingSummary: () => ({
    data: null,
    isSuccess: true,
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/features/guest/hooks', () => ({ useIsGuest: () => mockViewer.guest }));
jest.mock('@/features/matching/hooks', () => ({ useMyChats: () => ({ data: [] }) }));
jest.mock('@/features/business/photo-url', () => ({ useBusinessPhotoUrl: () => ({ data: null }) }));
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));
jest.mock('@/lib/haptics', () => ({
  haptics: { light: jest.fn(), selection: jest.fn(), success: jest.fn(), soft: jest.fn() },
}));
jest.mock('@/components/ui/sign-up-gate', () => ({ SignUpGate: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

const BUSINESS = {
  id: 'biz-1',
  name: 'Park Rooftop Bar',
  category: 'bar' as const,
  address: 'Rua do Alecrim 12',
};

const place = (over: Partial<BusinessDetailRow> = {}): BusinessDetailRow => ({
  id: BUSINESS.id,
  chat_id: null,
  city_id: 1,
  name: BUSINESS.name,
  category: BUSINESS.category,
  description: null,
  place_label: null,
  address: BUSINESS.address,
  hours_note: null,
  website_url: null,
  lat: 38.7112,
  lng: -9.1442,
  verified: false,
  claimed: true,
  member_count: 0,
  photos: [],
  links: [],
  hours: [],
  posts: [],
  ...over,
});

const MORNING = new Date(2026, 8, 1, 10, 0);

describe('the marker a business draws', () => {
  it('maps the kinds a pin has a glyph for, and lets the plan decide the rest', () => {
    expect(pinCategoryForBusiness('bar')).toBe('bar');
    expect(pinCategoryForBusiness('club')).toBe('club');
    expect(pinCategoryForBusiness('restaurant')).toBe('restaurant');
    expect(pinCategoryForBusiness('cafe')).toBe('restaurant');
    expect(pinCategoryForBusiness('hostel')).toBe('other');
    expect(pinCategoryForBusiness('tour')).toBe('other');
  });
});

describe('the pin form opened from a business page', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(MORNING);
    mockMutateAsync.mockClear();
    mockReverseGeocode.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const renderForm = (business: typeof BUSINESS | null) =>
    render(
      <PinFormSheet
        cityId={1}
        cityName="Lisbon"
        cityTimezone="Europe/Lisbon"
        coords={{ lat: 38.7112, lng: -9.1442 }}
        initialPlace={null}
        initialLabel={null}
        business={business}
        onClose={jest.fn()}
        onPosted={jest.fn()}
      />
    );

  it('arrives with the business already in the name and the address line', () => {
    renderForm(BUSINESS);
    expect(screen.getByTestId('venue-name-input').props.value).toBe('Park Rooftop Bar');
    expect(screen.getByText('Rua do Alecrim 12, Lisbon')).toBeTruthy();
    // A business knows its own street, so nobody's coordinate is looked up.
    expect(mockReverseGeocode).not.toHaveBeenCalled();
  });

  it('posts the business by id, with its category and coordinates', async () => {
    renderForm(BUSINESS);
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      businessId: 'biz-1',
      venueName: 'Park Rooftop Bar',
      category: 'bar',
      lat: 38.7112,
      lng: -9.1442,
      cityId: 1,
    });
  });

  // Renaming the spot is not un-choosing the business: somebody who came
  // from the bar's page and calls it "the rooftop" is still going to the bar.
  it('keeps the business when the spot is renamed', async () => {
    renderForm(BUSINESS);
    fireEvent.changeText(screen.getByTestId('venue-name-input'), 'The rooftop');
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      businessId: 'biz-1',
      venueName: 'The rooftop',
    });
  });

  // And a pin dropped on the map names nobody: the server may still infer
  // one by name and distance, but this form never guesses on its own.
  it('names no business at all when it was not opened from one', async () => {
    renderForm(null);
    fireEvent.changeText(screen.getByTestId('venue-name-input'), 'Park Rooftop Bar');
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({ businessId: null });
  });
});

describe('the business page', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(MORNING);
    mockDetail.data = place();
    mockViewer.guest = false;
    mockViewer.ownBusiness = null;
    mockMutateAsync.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('carries Plan to go for a traveler, and it opens the form pre-filled', () => {
    render(<PlaceScreen />);
    fireEvent.press(screen.getByText('Plan to go'));
    expect(screen.getByTestId('venue-name-input').props.value).toBe('Park Rooftop Bar');
    expect(screen.getByText('Put it on the map')).toBeTruthy();
  });

  it('does not offer it to a guest, who is behind the account wall', () => {
    mockViewer.guest = true;
    render(<PlaceScreen />);
    expect(screen.queryByText('Plan to go')).toBeNull();
  });

  it('nor to a business account, which never posts a plan (rule 8)', () => {
    mockViewer.ownBusiness = { id: 'someone-else' };
    render(<PlaceScreen />);
    expect(screen.queryByText('Plan to go')).toBeNull();
  });
});
