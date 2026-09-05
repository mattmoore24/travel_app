import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usePassedTravelers } from '@/features/matching/passed';

/**
 * The pass store's undo half. `add` existed from the start; `remove` is what
 * makes a mis-tapped Next recoverable, and it has to take out exactly one
 * person while everyone else on the list survives — both in state and in
 * what is written back to the device.
 */

const KEY = 'samewhere.passed.travelers.v1';
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('remove', () => {
  it('takes out one person and persists the survivors', async () => {
    const { result } = renderHook(() => usePassedTravelers());
    act(() => result.current.add('a'));
    act(() => result.current.add('b'));
    act(() => result.current.add('c'));
    expect(result.current.count).toBe(3);

    act(() => result.current.remove('b'));

    expect(result.current.has('a')).toBe(true);
    expect(result.current.has('b')).toBe(false);
    expect(result.current.has('c')).toBe(true);
    expect(result.current.count).toBe(2);

    const written = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as { id: string }[];
    expect(written.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('is a no-op for an id that was never added', async () => {
    const { result } = renderHook(() => usePassedTravelers());
    act(() => result.current.add('a'));

    act(() => result.current.remove('ghost'));

    expect(result.current.has('a')).toBe(true);
    expect(result.current.count).toBe(1);
    const written = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as { id: string }[];
    expect(written.map((e) => e.id)).toEqual(['a']);
  });
});

describe('the 14-day TTL still holds', () => {
  it('drops a stale entry on load and keeps a fresh one', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'stale', at: Date.now() - 15 * DAY_MS },
        { id: 'fresh', at: Date.now() - 1 * DAY_MS },
      ])
    );

    const { result } = renderHook(() => usePassedTravelers());
    await waitFor(() => expect(result.current.has('fresh')).toBe(true));
    expect(result.current.has('stale')).toBe(false);
    expect(result.current.count).toBe(1);
  });
});
