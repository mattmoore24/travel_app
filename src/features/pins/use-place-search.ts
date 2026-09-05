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

/**
 * Anywhere mode, for a business typing its own address with no city chosen:
 * the region MapKit is handed as a RANKING hint. A continent, not the
 * planet: MKCoordinateRegion(center:latitudinalMeters:) with a span near
 * 180 degrees centred off the equator is out of range, and ~18 degrees is
 * valid at any centre. A typed city still wins the ranking inside it.
 */
const WORLD_SPAN_M = 2_000_000;

/** Two letters against the whole planet is noise, and it costs MapKit quota. */
const MIN_QUERY_ANYWHERE = 3;

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
 *
 * Two modes. A traveler's pin search is scoped to the city they are browsing
 * (the city arm: a 30 km hint, a 40 km cut, the city's name appended to the
 * geocoder query). A business types its address with no city chosen at all
 * since 2026-09-05, because the server files the listing under the city its
 * marker is in (20260905130000): the anywhere arm hands MapKit a continent
 * and keeps its order. The only centres the anywhere arm ever uses are a
 * marker the person placed, or the origin; never a device position, which
 * section 7 rule 2 forbids and this file does not know how to read.
 */
export function usePlaceSearch(
  options: {
    query: string;
    /** Off while a picked result is being shown back, so it does not re-search itself. */
    enabled?: boolean;
  } & (
    | {
        anywhere: true;
        /** A marker the person placed, to favour that neighbourhood. */
        near?: { lat: number; lng: number } | null;
      }
    | { anywhere?: false; cityName: string; cityLat: number; cityLng: number }
  )
) {
  const { query, enabled = true } = options;
  const anywhere = options.anywhere === true;
  const cityName = options.anywhere ? '' : options.cityName;
  const centreLat = options.anywhere ? (options.near?.lat ?? 0) : options.cityLat;
  const centreLng = options.anywhere ? (options.near?.lng ?? 0) : options.cityLng;
  const minQuery = anywhere ? MIN_QUERY_ANYWHERE : MIN_QUERY;
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
        if (anywhere) {
          // The world, in MapKit's own order: the region is its relevance
          // hint and a typed city has to be allowed to beat proximity, so
          // nothing is cut by distance here.
          if (venueSearchAvailable) {
            const places = await searchPlaces({
              query: text,
              latitude: centreLat,
              longitude: centreLng,
              radiusMeters: WORLD_SPAN_M,
            });
            if (mine !== seq.current) {
              return;
            }
            if (places.length > 0) {
              setHits(places.slice(0, 6));
              setMessage(null);
              return;
            }
          }
          // The geocoder gets the bare text: it reads the city out of the
          // words, which is what the placeholder asks for.
          const results = await Location.geocodeAsync(text);
          if (mine !== seq.current) {
            return;
          }
          if (results.length > 0) {
            setHits(
              results.slice(0, 4).map((r) => ({
                name: text,
                address: null,
                locality: null,
                latitude: r.latitude,
                longitude: r.longitude,
                category: null,
              }))
            );
            setMessage(null);
            return;
          }
          setHits([]);
          setMessage('Nothing found for that. Add the city, or set the pin yourself.');
          return;
        }

        if (venueSearchAvailable) {
          const places = await searchPlaces({
            query: text,
            latitude: centreLat,
            longitude: centreLng,
            radiusMeters: SEARCH_RADIUS_M,
          });
          if (mine !== seq.current) {
            return;
          }
          const nearby = places.filter(
            (p) => distanceKm(p.latitude, p.longitude, centreLat, centreLng) <= MAX_KM_FROM_CENTER
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
          (r) => distanceKm(r.latitude, r.longitude, centreLat, centreLng) <= MAX_KM_FROM_CENTER
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
          setMessage(
            anywhere
              ? 'Search is down. Set the pin yourself for now.'
              : 'Search is down. Drag the map to the spot.'
          );
        }
      } finally {
        if (mine === seq.current) {
          setSearching(false);
        }
      }
    },
    [anywhere, centreLat, centreLng, cityName]
  );

  // Fire on a pause in typing rather than on every keystroke.
  useEffect(() => {
    const text = query.trim();
    if (!enabled || text.length < minQuery) {
      return;
    }
    const id = setTimeout(() => run(text), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [enabled, query, run, minQuery]);

  return { hits, message, searching, clear, minQuery };
}
