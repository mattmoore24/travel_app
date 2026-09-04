import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useTripSelection } from '@/features/matching/trip-selection';

const KEY = 'samewhere.travelers.trips.v1';
const ALL = ['a', 'b', 'c'];

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('the stored choice, per account', () => {
  it('is every trip until the read lands, then what was stored', async () => {
    await AsyncStorage.setItem(`${KEY}:alice`, JSON.stringify(['b']));
    const { result } = renderHook(() => useTripSelection('alice'));
    // Before the read: not hydrated, and every trip rather than a guess.
    expect(result.current.hydrated).toBe(false);
    expect(result.current.selected).toBeNull();
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.selected).toEqual(['b']);
  });

  it("never returns one account's choice to another", async () => {
    await AsyncStorage.setItem(`${KEY}:alice`, JSON.stringify(['b']));
    const { result, rerender } = renderHook(({ userId }) => useTripSelection(userId), {
      initialProps: { userId: 'alice' as string | null },
    });
    await waitFor(() => expect(result.current.selected).toEqual(['b']));
    rerender({ userId: 'bob' });
    // Bob's read has not landed: every trip, and not hydrated, not Alice's.
    expect(result.current.selected).toBeNull();
    expect(result.current.hydrated).toBe(false);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.selected).toBeNull();
  });

  it('a tap writes the choice, and All trips removes it', async () => {
    const { result } = renderHook(() => useTripSelection('alice'));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => result.current.toggle('b', ALL));
    expect(result.current.selected).toEqual(['b']);
    await waitFor(async () =>
      expect(JSON.parse((await AsyncStorage.getItem(`${KEY}:alice`)) ?? 'null')).toEqual(['b'])
    );
    act(() => result.current.selectAll());
    expect(result.current.selected).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem(`${KEY}:alice`)).toBeNull());
  });

  it('reads a broken value as every trip', async () => {
    await AsyncStorage.setItem(`${KEY}:alice`, JSON.stringify({ not: 'a list' }));
    const { result } = renderHook(() => useTripSelection('alice'));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.selected).toBeNull();
  });

  it('signed out is every trip and already hydrated', () => {
    const { result } = renderHook(() => useTripSelection(null));
    expect(result.current.hydrated).toBe(true);
    expect(result.current.selected).toBeNull();
  });
});
