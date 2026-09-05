import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { usePlaceSearch } from '@/features/pins/use-place-search';
import { searchPlaces, type LocalSearchResult } from '@/modules/local-search';

/**
 * One search, two modes.
 *
 * A traveler's pin search is scoped to the city they are browsing: a 30 km
 * hint to MapKit, a 40 km cut on what comes back, and the city's name
 * appended to the geocoder query. That arm is byte-for-byte what it was.
 *
 * A business typing its own address has no city chosen anywhere on the
 * screen since 2026-09-05, because the server files the listing under the
 * city its marker is in (20260905130000). So the anywhere arm hands MapKit
 * a continent as its ranking hint, keeps MapKit's own order (a typed city
 * has to be allowed to beat proximity), and gives the geocoder the bare
 * text so it can read the city out of the words. The only centres it ever
 * uses are a marker the person placed, or the origin — never a device
 * position, which section 7 rule 2 forbids.
 */

jest.mock('@/modules/local-search', () => ({
  venueSearchAvailable: true,
  searchPlaces: jest.fn(),
}));
jest.mock('expo-location', () => ({ geocodeAsync: jest.fn() }));

const mockSearchPlaces = searchPlaces as jest.MockedFunction<typeof searchPlaces>;
const mockGeocode = Location.geocodeAsync as jest.MockedFunction<typeof Location.geocodeAsync>;

/** The debounce in use-place-search.ts. */
const DEBOUNCE_MS = 280;

const place = (name: string, latitude: number, longitude: number): LocalSearchResult => ({
  name,
  address: null,
  locality: null,
  latitude,
  longitude,
  category: null,
});

/** Lisbon and Porto: about 275 km apart, so a city-mode cut would drop one. */
const LISBON = place('Rua da Rosa 12', 38.7108, -9.14);
const PORTO = place('Rua da Rosa 12', 41.1496, -8.61);
const LISBON_CENTRE = { cityName: 'Lisbon', cityLat: 38.7108, cityLng: -9.14 };

/** A promise the test resolves by hand, for ordering two answers. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let the debounce fire, then let the promises it started settle. */
async function pause() {
  await act(async () => {
    jest.advanceTimersByTime(DEBOUNCE_MS);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSearchPlaces.mockResolvedValue([]);
  mockGeocode.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('anywhere mode', () => {
  it('asks MapKit for a continent and keeps what it answers, in its order', async () => {
    mockSearchPlaces.mockResolvedValue([PORTO, LISBON]);
    const { result } = renderHook(() =>
      usePlaceSearch({ query: 'Rua da Rosa 12, Lisboa', anywhere: true })
    );
    await pause();
    await waitFor(() => expect(result.current.hits).toHaveLength(2));
    // The origin as the centre, because nothing better is known and a
    // device position is not a thing this hook can read; 2,000 km as the
    // span, which is a ranking hint rather than a fence.
    expect(mockSearchPlaces).toHaveBeenCalledTimes(1);
    expect(mockSearchPlaces).toHaveBeenCalledWith({
      query: 'Rua da Rosa 12, Lisboa',
      latitude: 0,
      longitude: 0,
      radiusMeters: 2_000_000,
    });
    // No distance cut: Porto is 275 km from Lisbon and both survive, in the
    // order MapKit ranked them.
    expect(result.current.hits).toEqual([PORTO, LISBON]);
    expect(result.current.message).toBeNull();
    // The geocoder is the fallback, not a second opinion.
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it('biases around the marker once there is one', async () => {
    mockSearchPlaces.mockResolvedValue([LISBON]);
    const { result } = renderHook(() =>
      usePlaceSearch({
        query: 'Rua da Rosa 12',
        anywhere: true,
        near: { lat: 38.71, lng: -9.14 },
      })
    );
    await pause();
    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    expect(mockSearchPlaces).toHaveBeenCalledWith({
      query: 'Rua da Rosa 12',
      latitude: 38.71,
      longitude: -9.14,
      radiusMeters: 2_000_000,
    });
  });

  it('needs three characters, because two against the planet is noise', async () => {
    const { result } = renderHook(() => usePlaceSearch({ query: 'Ru', anywhere: true }));
    expect(result.current.minQuery).toBe(3);
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS * 4);
    });
    expect(mockSearchPlaces).not.toHaveBeenCalled();
    expect(mockGeocode).not.toHaveBeenCalled();
    expect(result.current.hits).toEqual([]);
  });

  it('hands the geocoder the bare text when MapKit has nothing', async () => {
    mockSearchPlaces.mockResolvedValue([]);
    mockGeocode.mockResolvedValue([
      { latitude: 38.7108, longitude: -9.14 } as Location.LocationGeocodedLocation,
    ]);
    const { result } = renderHook(() =>
      usePlaceSearch({ query: 'Rua da Rosa 12, Lisboa', anywhere: true })
    );
    await pause();
    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    // No city suffix: the placeholder asked for the city in the words, and
    // the geocoder reads it out of them.
    expect(mockGeocode).toHaveBeenCalledWith('Rua da Rosa 12, Lisboa');
    expect(result.current.hits[0]).toEqual({
      name: 'Rua da Rosa 12, Lisboa',
      address: null,
      locality: null,
      latitude: 38.7108,
      longitude: -9.14,
      category: null,
    });
    expect(result.current.message).toBeNull();
  });

  it('says honestly when both have nothing, and when the search is down', async () => {
    mockSearchPlaces.mockResolvedValue([]);
    mockGeocode.mockResolvedValue([]);
    const empty = renderHook(() =>
      usePlaceSearch({ query: 'Nowhere Street 0, Atlantis', anywhere: true })
    );
    await pause();
    await waitFor(() =>
      expect(empty.result.current.message).toBe(
        'Nothing found for that. Add the city, or set the pin yourself.'
      )
    );
    expect(empty.result.current.hits).toEqual([]);
    expect(empty.result.current.searching).toBe(false);
    empty.unmount();

    mockSearchPlaces.mockRejectedValue(new Error('MKErrorDomain 4'));
    const down = renderHook(() =>
      usePlaceSearch({ query: 'Rua da Rosa 12, Lisboa', anywhere: true })
    );
    await pause();
    await waitFor(() =>
      expect(down.result.current.message).toBe('Search is down. Set the pin yourself for now.')
    );
    expect(down.result.current.hits).toEqual([]);
    expect(down.result.current.searching).toBe(false);
  });

  it('never lets a stale answer land', async () => {
    // The slow request for the shorter text resolves AFTER the request for
    // the text it was replaced by. What shows is the newer answer.
    const older = deferred<LocalSearchResult[]>();
    const newer = deferred<LocalSearchResult[]>();
    mockSearchPlaces.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => usePlaceSearch({ query, anywhere: true }),
      { initialProps: { query: 'Rua da Rosa' } }
    );
    await pause();
    expect(mockSearchPlaces).toHaveBeenCalledTimes(1);

    rerender({ query: 'Rua da Rosa 12, Lisboa' });
    await pause();
    expect(mockSearchPlaces).toHaveBeenCalledTimes(2);

    await act(async () => {
      newer.resolve([LISBON]);
    });
    await waitFor(() => expect(result.current.hits).toEqual([LISBON]));

    await act(async () => {
      older.resolve([PORTO, PORTO, PORTO]);
    });
    // Still the newer answer, and the spinner is off: the older response was
    // dropped on arrival rather than overwriting the list.
    expect(result.current.hits).toEqual([LISBON]);
    expect(result.current.searching).toBe(false);
  });
});

describe('city mode is untouched', () => {
  it('keeps the 30 km hint, the 40 km cut and the two-character floor', async () => {
    // A hit 100 km out is somebody else's city, and is filtered away.
    const farOut = place('Rua da Rosa 12', 38.7108 + 0.9, -9.14);
    mockSearchPlaces.mockResolvedValue([LISBON, farOut]);
    const { result } = renderHook(() =>
      usePlaceSearch({ query: 'Rua da Rosa 12', ...LISBON_CENTRE })
    );
    expect(result.current.minQuery).toBe(2);
    await pause();
    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    expect(mockSearchPlaces).toHaveBeenCalledWith({
      query: 'Rua da Rosa 12',
      latitude: LISBON_CENTRE.cityLat,
      longitude: LISBON_CENTRE.cityLng,
      radiusMeters: 30_000,
    });
    expect(result.current.hits).toEqual([LISBON]);
  });

  it('still scopes the geocoder to the city by name', async () => {
    mockSearchPlaces.mockResolvedValue([]);
    mockGeocode.mockResolvedValue([
      { latitude: 38.72, longitude: -9.15 } as Location.LocationGeocodedLocation,
    ]);
    const { result } = renderHook(() =>
      usePlaceSearch({ query: 'Rua da Rosa 12', ...LISBON_CENTRE })
    );
    await pause();
    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    expect(mockGeocode).toHaveBeenCalledWith('Rua da Rosa 12, Lisbon');
    expect(result.current.hits[0]?.locality).toBe('Lisbon');
  });
});
