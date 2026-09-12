import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';

import BusinessEditScreen from '@/app/business-edit';
import { FormSkeleton } from '@/components/ui/skeleton';
import type { MyBusinessRow } from '@/lib/database.types';

/**
 * The business editor before its rows.
 *
 * It returned null while the listing was in the air (a blank screen) and a
 * centred spinner while the hours were, on a form screen whose title and
 * button were both already known. The form's own shape stands there now,
 * under the title the form will carry, and the scaffold does not move when
 * the fields arrive. A query that is never going to answer (no session) is
 * still nothing to edit, and a failed one gets the LoadError every other
 * screen in the feature has.
 */

type HourRow = { id: string; business_id: string; weekday: number; position: number };
type Answer = { data: HourRow[] | null; error: Error | null };

// jest.mock factories are hoisted, so shared state is named mock*.
const mockOwn = {
  data: null as MyBusinessRow | null,
  isPending: true,
  fetchStatus: 'fetching' as 'idle' | 'fetching',
  isError: false,
  error: null as unknown,
  refetch: jest.fn(),
};
const mockParams: { section?: string } = {};
let mockSettleHours: (answer: Answer) => void = () => {};
const mockFetchHours = jest.fn(
  () =>
    new Promise<Answer>((resolve) => {
      mockSettleHours = resolve;
    })
);

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => true, push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/business/hooks', () => ({
  useOwnBusiness: () => mockOwn,
  useUpdateOwnBusiness: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateBusinessLocation: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/features/profile/hooks', () => ({ useOwnUserId: () => 'u1' }));
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ order: () => mockFetchHours() }),
        }),
      }),
    }),
  },
}));
jest.mock('@/lib/haptics', () => ({
  haptics: { soft: jest.fn(), light: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
// The blocks the details section does not mount, whose modules reach native
// code: the map picker, the address search and the photo grid.
jest.mock('@/features/pins/location-picker', () => ({ LocationPicker: () => null }));
jest.mock('@/features/business/address-field', () => ({
  BusinessAddressField: () => null,
  addressFrom: () => ({}),
}));
jest.mock('@/features/business/business-photos', () => ({ BusinessPhotos: () => null }));
jest.mock('@/features/business/business-marker', () => ({ PlaceGlyph: () => null }));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

const business = (): MyBusinessRow =>
  ({
    id: 'biz-1',
    name: 'Once Again Hostel',
    category: 'hostel',
    description: null,
    place_label: null,
    address: null,
    hours_note: null,
    website_url: null,
    lat: 13.75,
    lng: 100.5,
    city_id: 1,
    state: 'listed',
    verified: false,
  }) as unknown as MyBusinessRow;

const show = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BusinessEditScreen />
    </QueryClientProvider>
  );
};

const skeletons = () => screen.UNSAFE_queryAllByType(FormSkeleton);
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  mockOwn.data = null;
  mockOwn.isPending = true;
  mockOwn.fetchStatus = 'fetching';
  mockOwn.isError = false;
  mockOwn.error = null;
  delete mockParams.section;
});

describe('while the listing is on its way', () => {
  it('stands the form’s shape under its title, with Save held', () => {
    show();
    expect(skeletons()).toHaveLength(1);
    expect(screen.getByText('Edit your business')).toBeTruthy();
    expect(button('Save').props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByText('Name')).toBeNull();
  });

  it('titles the placeholder for the section that was asked for', () => {
    mockParams.section = 'hours';
    show();
    expect(screen.getByText('Your hours')).toBeTruthy();
    expect(skeletons()).toHaveLength(1);
  });
});

describe('when the listing is never coming', () => {
  it('renders nothing for a query that is never going to ask', () => {
    // Disabled without a session: isPending forever, fetchStatus idle.
    mockOwn.fetchStatus = 'idle';
    show();
    expect(screen.toJSON()).toBeNull();
  });

  it('says so with a retry when the fetch failed', () => {
    mockOwn.isPending = false;
    mockOwn.isError = true;
    mockOwn.error = new Error('offline');
    show();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(skeletons()).toHaveLength(0);
  });
});

describe('while the hours are on their way', () => {
  it('keeps the same shape, then mounts the form when the rows land', async () => {
    mockOwn.data = business();
    mockOwn.isPending = false;
    mockOwn.fetchStatus = 'idle';
    mockParams.section = 'details';
    show();
    expect(skeletons()).toHaveLength(1);
    expect(screen.getByText('Your name and description')).toBeTruthy();
    await act(async () => {
      mockSettleHours({ data: [], error: null });
      await Promise.resolve();
    });
    expect(await screen.findByText('Name')).toBeTruthy();
    expect(skeletons()).toHaveLength(0);
    // Same title before and after: the scaffold did not move.
    expect(screen.getByText('Your name and description')).toBeTruthy();
  });
});
