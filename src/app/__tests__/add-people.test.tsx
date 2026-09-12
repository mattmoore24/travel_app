import { render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import AddPeopleScreen from '@/app/add-people/[chatId]';
import { ChatRowSkeleton } from '@/components/ui/skeleton';
import type { KnownPersonRow } from '@/lib/database.types';

/**
 * Add people to a group: the first open used to be a blank list under the
 * search box until the people arrived (ListEmptyComponent was null while
 * loading), and a failed fetch read as "Nobody yet". Skeleton before words,
 * the empty sentence only once the server has answered.
 */

const mockPeople = {
  data: undefined as KnownPersonRow[] | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: jest.fn(),
};
// What the signer answers: undefined is "still signing", a string the URL.
let mockUrl: string | null | undefined = null;

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ chatId: 'g1' }),
}));

jest.mock('@/features/groups/hooks', () => ({
  usePeopleYouKnow: () => mockPeople,
  useGroupMembers: () => ({ data: [] }),
  useAddToGroup: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@/features/profile/hooks', () => ({
  usePhotoUrl: () => ({ data: mockUrl, isError: false }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

const person = (over: Partial<KnownPersonRow> = {}): KnownPersonRow => ({
  user_id: 'u2',
  display_name: 'Ana',
  photo_path: 'u2/0.jpg',
  verified: false,
  chatted: true,
  in_a_group: false,
  ...over,
});

beforeEach(() => {
  mockPeople.data = undefined;
  mockPeople.isLoading = false;
  mockPeople.isError = false;
  mockPeople.error = null;
  mockUrl = null;
});

describe('while the people are on their way', () => {
  it('draws three rows of shape, never "Nobody yet"', () => {
    mockPeople.isLoading = true;
    render(<AddPeopleScreen />);
    expect(screen.UNSAFE_getAllByType(ChatRowSkeleton)).toHaveLength(3);
    expect(screen.queryByText('Nobody yet')).toBeNull();
  });
});

describe('when the fetch fails', () => {
  it('says so and offers a retry, never "Nobody yet"', () => {
    mockPeople.isError = true;
    mockPeople.error = new Error('offline');
    render(<AddPeopleScreen />);
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText('Nobody yet')).toBeNull();
  });
});

describe('once the server has answered', () => {
  it('says "Nobody yet" only for a genuinely empty list', () => {
    mockPeople.data = [];
    render(<AddPeopleScreen />);
    expect(screen.getByText('Nobody yet')).toBeTruthy();
  });

  it('holds the monogram back while a face is still being signed', () => {
    // The letter is for somebody with no photo, not for one whose photo is
    // a round trip away; the disc stays the sunken ground until then.
    mockPeople.data = [person()];
    mockUrl = undefined;
    render(<AddPeopleScreen />);
    expect(screen.getByLabelText('Add Ana')).toBeTruthy();
    expect(screen.queryByText('A')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('draws the face once, keyed on the person so a recycled row cannot wear the wrong one', () => {
    mockPeople.data = [person()];
    mockUrl = 'https://signed.example/u2/0.jpg?token=1';
    render(<AddPeopleScreen />);
    const images = screen.UNSAFE_getAllByType(Image);
    expect(images).toHaveLength(1);
    expect(images[0].props.recyclingKey).toBe('u2');
    expect(images[0].props.source.cacheKey).toBe('u2/0.jpg');
  });

  it('stands a letter in for somebody with no photo', () => {
    mockPeople.data = [person({ photo_path: null })];
    render(<AddPeopleScreen />);
    expect(screen.getByText('A')).toBeTruthy();
  });
});
