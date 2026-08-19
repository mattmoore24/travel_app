import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { GlassSurface } from '@/components/ui/glass-surface';
import { Fonts, HitTarget, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

type PinSearchFieldProps = {
  cityName: string;
  cityLat: number;
  cityLng: number;
  /** Fires with the geocoded coordinate and the text the user typed. */
  onFound: (coords: { lat: number; lng: number }, query: string) => void;
};

/** Anything geocoded further out than this isn't this city's plan. */
const MAX_KM_FROM_CENTER = 40;

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Type a place instead of panning to it: the query is geocoded on-device
 * (CLGeocoder — no API key, no network dependency of ours, nothing about the
 * user's own location), scoped to the active city, and the map flies there.
 * A miss shakes the field; the pin stays where it was.
 */
export function PinSearchField({ cityName, cityLat, cityLng, onFound }: PinSearchFieldProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [miss, setMiss] = useState(false);
  const shake = useSharedValue(0);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  const fail = () => {
    setMiss(true);
    haptics.error();
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutable by contract
    shake.value = withSequence(
      withTiming(-7, { duration: 45 }),
      withTiming(7, { duration: 90 }),
      withTiming(-5, { duration: 90 }),
      withTiming(0, { duration: 45 })
    );
  };

  const search = async () => {
    const text = query.trim();
    if (text.length === 0 || searching) {
      return;
    }
    setSearching(true);
    setMiss(false);
    try {
      // Scoping the query with the city name keeps "Rua Rosa" in Lisbon
      // rather than the best match anywhere on Earth.
      const results = await Location.geocodeAsync(`${text}, ${cityName}`);
      const hit = results.find(
        (r) => distanceKm(r.latitude, r.longitude, cityLat, cityLng) <= MAX_KM_FROM_CENTER
      );
      if (hit) {
        haptics.light();
        inputRef.current?.blur();
        onFound({ lat: hit.latitude, lng: hit.longitude }, text);
      } else {
        fail();
      }
    } catch {
      // Geocoding unavailable (e.g. Android without location permission) —
      // panning the map by hand is the first-class path anyway.
      fail();
    } finally {
      setSearching(false);
    }
  };

  return (
    <Animated.View style={shakeStyle}>
      {/* Regular glass, not clear: this control carries live text over the
          map, and clear glass needs a dimming layer to stay legible. */}
      <GlassSurface radius={Radius.pill}>
        <View style={styles.row}>
          <SymbolView
            name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
            size={17}
            tintColor={miss ? theme.danger : theme.textSecondary}
          />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setMiss(false);
            }}
            placeholder={`Search a place in ${cityName}…`}
            placeholderTextColor={theme.textSecondary}
            returnKeyType="search"
            autoCorrect={false}
            onSubmitEditing={search}
            accessibilityLabel="Search for an address or place"
            style={[styles.input, { color: theme.text, fontFamily: Fonts?.sans }]}
          />
          {searching ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
        </View>
      </GlassSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    height: HitTarget + 4,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
});
