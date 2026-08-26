import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Type, Elevation, Fonts, HitTarget, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { searchPlaces, venueSearchAvailable, type LocalSearchResult } from '@/modules/local-search';

type PinSearchFieldProps = {
  cityName: string;
  cityLat: number;
  cityLng: number;
  /**
   * The whole place, not just where it is. The pin form fills its own
   * location block from this, so nobody retypes what the map already knows.
   */
  onFound: (place: LocalSearchResult) => void;
};

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
 * Find the place you're planning to be, by typing its name.
 *
 * Suggestions arrive as you type — no button to hunt for, which is what
 * everyone expects from a search field and what the founder asked for after
 * using it. Two things this has to get right that a naive typeahead does not:
 *
 *   1. **Stale responses.** A slow request for "tim" must not overwrite the
 *      results for "time out market" just because it landed later. Every
 *      search carries a sequence number and anything but the newest is
 *      dropped on arrival.
 *   2. **Honest emptiness.** "No results yet" and "there is genuinely nothing
 *      by that name here" look identical unless you say which is which.
 *
 * Panning the map by hand stays the first-class way to place a pin; this is
 * the shortcut.
 */
export function PinSearchField({ cityName, cityLat, cityLng, onFound }: PinSearchFieldProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hits, setHits] = useState<LocalSearchResult[]>([]);

  // Guards against out-of-order responses; see the note above.
  const seq = useRef(0);

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

  // Clearing happens on the keystroke, not in an effect: it is a response to
  // what the user just did, and doing it here keeps the effect below free of
  // synchronous state writes.
  const onChangeText = (text: string) => {
    setQuery(text);
    if (text.trim().length < MIN_QUERY) {
      // Abandon anything in flight so a late response cannot repopulate the
      // list after the field has been emptied.
      seq.current += 1;
      setHits([]);
      setMessage(null);
      setSearching(false);
    }
  };

  // Fire on a pause in typing rather than on every keystroke.
  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY) {
      return;
    }
    const id = setTimeout(() => run(text), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, run]);

  const pick = (result: LocalSearchResult) => {
    haptics.light();
    inputRef.current?.blur();
    seq.current += 1;
    setHits([]);
    setMessage(null);
    setQuery('');
    // The venue's own name, address and category go into the pin, so
    // "Pensão Amor" arrives spelled the way the map spells it and nobody is
    // asked what kind of place it is.
    onFound(result);
  };

  const showClear = query.length > 0;

  return (
    <View style={styles.wrap}>
      {/* Opaque, not glass: a text field inside a UIVisualEffectView never
          receives the tap that would focus it. */}
      <View style={[styles.row, Elevation.floating, { backgroundColor: theme.surface }]}>
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={17}
          tintColor={message ? theme.danger : theme.textSecondary}
        />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onChangeText}
          placeholder={
            venueSearchAvailable ? `Search ${cityName}` : `Street or area in ${cityName}`
          }
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="words"
          clearButtonMode="never"
          // The Search key blurs, but nothing on screen said so, and "Pin
          // here" sits underneath the keyboard the whole time somebody is
          // typing. A labelled Done is the same affordance the pin form one
          // step later already uses.
          {...keyboardDoneProps}
          accessibilityLabel={`Search ${cityName}`}
          testID="pin-search-input"
          style={[styles.input, { color: theme.text, fontFamily: Fonts?.sans }]}
        />
        {searching ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
        {showClear && !searching ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
            // Through onChangeText, not setQuery: onChangeText is the only
            // thing that also clears the hits and the "nothing by that name"
            // line, so clearing by hand used to leave a stale dropdown over
            // the map above an empty field claiming nothing was searched.
            onPress={() => {
              onChangeText('');
              inputRef.current?.focus();
            }}>
            <SymbolView
              name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
              size={17}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      {hits.length > 0 ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(100)}
          style={[styles.results, { backgroundColor: theme.surface }, Elevation.floating]}>
          {hits.map((hit, i) => (
            <PressableScale
              key={`${hit.name}:${hit.latitude}:${hit.longitude}`}
              accessibilityRole="button"
              accessibilityLabel={hit.name}
              haptic="selection"
              scaleTo={0.99}
              onPress={() => pick(hit)}
              style={[
                styles.result,
                i > 0
                  ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline }
                  : null,
              ]}>
              <ThemedText numberOfLines={1}>{hit.name}</ThemedText>
              {hit.address || hit.locality ? (
                <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                  {[hit.address, hit.locality].filter(Boolean).join(', ')}
                </ThemedText>
              ) : null}
            </PressableScale>
          ))}
        </Animated.View>
      ) : null}

      {message ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          style={[styles.message, { backgroundColor: theme.surface }, Elevation.raised]}>
          <ThemedText type="footnote" themeColor="textSecondary">
            {message}
          </ThemedText>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingLeft: Space.lg,
    paddingRight: Space.lg,
    height: HitTarget + 6,
    borderRadius: Radius.pill,
  },
  input: {
    flex: 1,
    fontSize: Type.body.fontSize,
    paddingVertical: 0,
  },
  message: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  results: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  result: {
    gap: 2,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
});
