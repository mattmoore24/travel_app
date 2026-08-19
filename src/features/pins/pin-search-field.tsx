import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, Fonts, HitTarget, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

type PinSearchFieldProps = {
  cityName: string;
  cityLat: number;
  cityLng: number;
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
 * Jump the map to an address or area. Two things used to make this look
 * completely broken on a real phone:
 *
 *   1. the input was mounted inside a native visual-effect view, whose
 *      content view does not take touches — the field could never even be
 *      focused, so nothing typed ever happened;
 *   2. every failure collapsed into one silent shake, including "that is a
 *      venue name, and the geocoder only knows addresses".
 *
 * So: a plain opaque field that takes taps, an explicit search button, and a
 * message that says which of those two things went wrong. Panning the map by
 * hand stays the first-class way to place a pin — this is a shortcut, and it
 * now admits when it cannot help.
 */
export function PinSearchField({ cityName, cityLat, cityLng, onFound }: PinSearchFieldProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const shake = useSharedValue(0);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  const fail = (text: string) => {
    setMessage(text);
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
    setMessage(null);
    try {
      // Scoped to the city so "Rua Rosa" lands here rather than the best
      // match anywhere on Earth.
      const results = await Location.geocodeAsync(`${text}, ${cityName}`);
      const hit = results.find(
        (r) => distanceKm(r.latitude, r.longitude, cityLat, cityLng) <= MAX_KM_FROM_CENTER
      );
      if (hit) {
        haptics.light();
        inputRef.current?.blur();
        setMessage(null);
        onFound({ lat: hit.latitude, lng: hit.longitude }, text);
      } else if (results.length > 0) {
        fail(`That one is not in ${cityName}. Try adding the street.`);
      } else {
        // The honest limit: this looks up addresses, not venue names.
        fail('No match. Street or area names work best, or drag the map to the spot.');
      }
    } catch {
      fail('Search is unavailable right now. Drag the map to the spot instead.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Animated.View style={shakeStyle}>
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
            onChangeText={(text) => {
              setQuery(text);
              setMessage(null);
            }}
            placeholder={`Street or area in ${cityName}`}
            placeholderTextColor={theme.textSecondary}
            returnKeyType="search"
            autoCorrect={false}
            onSubmitEditing={search}
            accessibilityLabel="Search for an address or area"
            testID="pin-search-input"
            style={[styles.input, { color: theme.text, fontFamily: Fonts?.sans }]}
          />
          {searching ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : query.trim().length > 0 ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Search"
              haptic="soft"
              scaleTo={0.92}
              onPress={search}
              style={[styles.go, { backgroundColor: theme.accent }]}>
              <SymbolView
                name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                size={14}
                tintColor={theme.onAccent}
              />
            </PressableScale>
          ) : null}
        </View>
      </Animated.View>
      {message ? (
        <Animated.View
          entering={FadeIn.duration(160)}
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
    paddingRight: Space.xs,
    height: HitTarget + 6,
    borderRadius: Radius.pill,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  go: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
});
