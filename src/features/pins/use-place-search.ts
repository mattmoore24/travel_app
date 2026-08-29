import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { searchPlaces, venueSearchAvailable, type LocalSearchResult } from '@/modules/local-search';

/** Results outside this are somebody else's city. */
const SEARCH_RADIUS_M = 30_000;

/** Anything geocoded further out than this isn't this city's plan. */
const MAX_KM_FROM_CENTER = 40;

/**
 * Long enough that a search fires when you pause, short enough that it never
 * feels like waiting. Below this, every keystroke would start a request the
 * next keystroke throws away.
 */
const DEBOUNCE_MS = 280;

/** One or two letters match half the city and tell the user nothing. */
const MIN_QUERY = 2;

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Finding a place in a city by typing at it.
 *
 * Extracted from PinSearchField so a business can use the same search to find
 * its own front door. The two screens want different chrome and, crucially,
 * different ownership of the TEXT: a traveler's field empties when they pick
 * a venue, because the pin form below then shows what was picked; a business
 * is typing its ADDRESS and the words have to stay in the box. So the hook
 * owns the searching and the caller owns the string.
 *
 * Two things this has to get right that a naive typeahead does not:
 *
 *   1. **Stale responses.** A slow request for "tim" must not overwrite the
 *      results for "time out market" just because it landed later. Every
 *      search carries a sequence number and anything but the newest is
 *      dropped on arrival.
 *   2. **Honest emptiness.** "No results yet" and "there is genuinely nothing
 *      by that name here" look identical unless you say which is which.
 */
export function usePlaceSearch({
  query,
  cityName,
  cityLat,
  cityLng,
  /** Off while a picked result is being shown back, so it does not re-search itself. */
  enabled = true,
}: {
  query: string;
  cityName: string;
  cityLat: number;
  cityLng: number;
  enabled?: boolean;
}) {
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hits, setHits] = useState<LocalSearchResult[]>([]);

  // Guards against out-of-order responses; see the note above.
  const seq = useRef(0);

  const clear = useCallback(() => {
    // Abandon anything in flight so a late response cannot repopulate the
    // list after the field has been emptied.
    seq.current += 1;
    setHits([]);
    setMessage(null);
    setSearching(false);
  }, []);

  const run = useCallback(
    async (text: string) => {
      const mine = ++seq.current;
      setSearching(true);
      try {
        if (venueSearchAvailable) {
          const places = await searchPlaces({
            query: text,
            latitude: cityLat,
            longitude: cityLng,
            radiusMeters: SEARCH_RADIUS_M,
          });
          if (mine !== seq.current) {
            return;
          }
          const nearby = places.filter(
            (p) => distanceKm(p.latitude, p.longitude, cityLat, cityLng) <= MAX_KM_FROM_CENTER
          );
          if (nearby.length > 0) {
            setHits(nearby.slice(0, 6));
            setMessage(null);
            return;
          }
        }

        // Either this build predates the venue module (an over-the-air update
        // can reach one) or the venue index had nothing. Fall back to
        // addresses, scoped to the city so "Rua Rosa" lands here.
        const results = await Location.geocodeAsync(`${text}, ${cityName}`);
        if (mine !== seq.current) {
          return;
        }
        const near = results.filter(
          (r) => distanceKm(r.latitude, r.longitude, cityLat, cityLng) <= MAX_KM_FROM_CENTER
        );
        if (near.length > 0) {
          setHits(
            near.slice(0, 4).map((r) => ({
              name: text,
              address: null,
              locality: cityName,
              latitude: r.latitude,
              longitude: r.longitude,
              category: null,
            }))
          );
          setMessage(null);
          return;
        }
        setHits([]);
        setMessage(
          results.length > 0
            ? `Found that, but not in ${cityName}.`
            : `Nothing by that name in ${cityName}. Try the street, or drag the map to the spot.`
        );
      } catch {
        if (mine === seq.current) {
          setHits([]);
          setMessage('Search is down. Drag the map to the spot.');
        }
      } finally {
        if (mine === seq.current) {
          setSearching(false);
        }
      }
    },
    [cityLat, cityLng, cityName]
  );

  // Fire on a pause in typing rather than on every keystroke.
  useEffect(() => {
    const text = query.trim();
    if (!enabled || text.length < MIN_QUERY) {
      return;
    }
    const id = setTimeout(() => run(text), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [enabled, query, run]);

  return { hits, message, searching, clear, minQuery: MIN_QUERY };
}
