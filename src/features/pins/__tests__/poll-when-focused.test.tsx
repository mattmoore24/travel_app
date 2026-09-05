import { renderHook } from '@testing-library/react-native';

import { useMapHeat, useMapPins } from '@/features/guest/hooks';
import { useCityPins, useHeatCells } from '@/features/pins/hooks';

/**
 * The map polls so expired pins cannot linger - but NativeTabs keeps the Map
 * tab mounted, so before this the interval kept firing while somebody read a
 * chat: a request a minute, on roaming data, for a screen nobody was looking
 * at. The interval is tab-scoped now; staleTime still refetches the moment
 * the tab comes back, which is the only moment lingering could be seen.
 */

let mockFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
}));

const mockUseQuery = jest.fn((_options: unknown) => ({ data: undefined }));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: (options: unknown) => mockUseQuery(options),
}));

function optionsOf(hook: () => unknown): { refetchInterval: unknown; staleTime: unknown } {
  mockUseQuery.mockClear();
  renderHook(hook);
  // The hook under test issues the LAST useQuery of its own render:
  // useMapPins asks useIsBusiness (itself a query) before building the map
  // query, so the first call is not always the one being asserted.
  expect(mockUseQuery).toHaveBeenCalled();
  return mockUseQuery.mock.calls[mockUseQuery.mock.calls.length - 1]![0] as never;
}

const HOOKS: [string, () => unknown, number][] = [
  ['useCityPins', () => useCityPins(1), 60_000],
  ['useHeatCells', () => useHeatCells(1, null), 120_000],
  ['useMapPins', () => useMapPins(1), 60_000],
  ['useMapHeat', () => useMapHeat(1, null), 60_000],
];

describe.each(HOOKS)('%s', (_name, hook, interval) => {
  it('polls while the tab is the one being looked at', () => {
    mockFocused = true;
    expect(optionsOf(hook).refetchInterval).toBe(interval);
  });

  it('stops polling the moment it is not', () => {
    mockFocused = false;
    expect(optionsOf(hook).refetchInterval).toBe(false);
  });

  it('keeps its staleTime, so coming back refetches once', () => {
    mockFocused = false;
    expect(optionsOf(hook).staleTime).toBeLessThanOrEqual(60_000);
  });
});
