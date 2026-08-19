import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Springs } from '@/constants/theme';
import type { PinCategory } from '@/lib/database.types';

/**
 * One glyph per category, drawn white on the pin body. Emoji markers read as
 * stickers on a basemap; template glyphs read as cartography (docs/DESIGN.md).
 */
const CATEGORY_GLYPHS: Record<PinCategory, SymbolViewProps['name']> = {
  bar: { ios: 'wineglass.fill', android: 'wine_bar', web: 'wine_bar' },
  restaurant: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  club: { ios: 'music.note', android: 'music_note', web: 'music_note' },
  museum: { ios: 'building.columns.fill', android: 'museum', web: 'museum' },
  monument: { ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' },
  beach: { ios: 'beach.umbrella.fill', android: 'beach_access', web: 'beach_access' },
  hike: { ios: 'figure.hiking', android: 'hiking', web: 'hiking' },
  other: { ios: 'mappin', android: 'place', web: 'place' },
};

const SEEDED_GLYPH: SymbolViewProps['name'] = { ios: 'star.fill', android: 'star', web: 'star' };

/**
 * Two colours only: travelers pin in the brand indigo, curated spots in the
 * campfire amber — the map stays "Samewhere blue + amber" instead of a
 * carnival of category hues. The glyph carries the category.
 * Fixed values (not theme tokens): markers sit on the basemap, which doesn't
 * follow the app's light/dark surfaces, and both clear 3:1 on it.
 */
const PIN_INDIGO = '#2A4C9B';
const PIN_AMBER = '#C77B14';
const PIN_RING = '#FFFFFF';

/**
 * Marker anchoring is split by provider (verified in react-native-maps
 * types): `anchor` is Google/Android-only; Apple Maps positions the view by
 * its CENTER plus `centerOffset` points. Without the offset every pin tip
 * would sit ~20pt south of its venue on iOS.
 */
export const MARKER_ANCHOR = { x: 0.5, y: 1 };
export const MARKER_CENTER_OFFSET = { x: 0, y: -20 };

type PinMarkerViewProps = {
  category: PinCategory;
  seeded: boolean;
  selected?: boolean;
};

/**
 * The marker artwork: a ringed dot with a tail, tip at the exact coordinate.
 * Rasterized by react-native-maps after each settle — `useMarkerTracking`
 * below tells the Marker when it must keep re-rendering (during the
 * selected-state spring), because with `tracksViewChanges={false}` the view
 * is a bitmap and animation frames would never paint.
 */
export function PinMarkerView({ category, seeded, selected = false }: PinMarkerViewProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(selected ? 1.12 : 1, Springs.snap);
  }, [selected, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const fill = seeded ? PIN_AMBER : PIN_INDIGO;
  const glyph = seeded ? SEEDED_GLYPH : CATEGORY_GLYPHS[category];

  return (
    <Animated.View
      // Apple's classic drop-in when a pin appears (new pins and map load
      // alike). Live views on Apple Maps, so the spring actually paints.
      entering={FadeInDown.springify().mass(1).damping(14).stiffness(260)}
      style={[styles.wrap, animatedStyle]}>
      <View style={[styles.body, { backgroundColor: fill }, selected && styles.bodySelected]}>
        <SymbolView name={glyph} size={15} tintColor={PIN_RING} />
      </View>
      <View style={[styles.tail, { backgroundColor: fill }]} />
    </Animated.View>
  );
}

/**
 * Marker rasterization control: track view changes briefly on mount (so the
 * glyph is in the bitmap) and around every selected-state change (so the
 * spring actually paints), then freeze for map-pan performance.
 */
export function useMarkerTracking(selected: boolean): boolean {
  const [tracking, setTracking] = useState(true);
  // Re-arm during render when `selected` flips — the sanctioned
  // "storing information from previous renders" pattern.
  const [prevSelected, setPrevSelected] = useState(selected);
  if (prevSelected !== selected) {
    setPrevSelected(selected);
    if (!tracking) {
      setTracking(true);
    }
  }
  useEffect(() => {
    if (!tracking) {
      return;
    }
    const timer = setTimeout(() => setTracking(false), 500);
    return () => clearTimeout(timer);
  }, [tracking]);
  return tracking;
}

const BODY = 34;
const TAIL = 11;

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    // Room for the spring overshoot so nothing clips at the bitmap edge.
    padding: 4,
  },
  body: {
    width: BODY,
    height: BODY,
    borderRadius: BODY / 2,
    borderWidth: 2.5,
    borderColor: PIN_RING,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bodySelected: {
    shadowOpacity: 0.35,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
  },
  tail: {
    width: TAIL,
    height: TAIL,
    marginTop: -(TAIL / 2 + 4),
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
    zIndex: -1,
  },
});
