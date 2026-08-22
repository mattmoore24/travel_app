import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Radius, Springs } from '@/constants/theme';
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
 * Two colours only, both warm: travelers pin in the campfire amber, curated
 * spots in gold. The glyph carries the category, so the map stays two
 * colours instead of a carnival of category hues.
 *
 * Warm, not the brand blue, and that is deliberate. The app is dark now and
 * the basemap follows it, so an indigo marker would sit on a dark navy map
 * and a heat circle in the same indigo would effectively disappear. Warm
 * light on an unlit city is the whole idea of the palette.
 *
 * Fixed values rather than theme tokens: markers sit on the basemap, which
 * does not follow the app's own surfaces. The glyph is the app's ink because
 * white on amber is 2.1:1 and unreadable; ink on amber is 9.0:1.
 */
const PIN_AMBER = '#FF9A5A';
const PIN_GOLD = '#FFC168';
const PIN_GLYPH = '#0E1020';
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
  /**
   * The poster's profile photo. Present only for signed-in viewers: the
   * server strips identity from a guest's pin feed, so a guest simply never
   * has a URL to render here.
   */
  photoUri?: string | null;
};

/**
 * The marker artwork: a ringed dot with a tail, tip at the exact coordinate.
 * Rasterized by react-native-maps after each settle — `useMarkerTracking`
 * below tells the Marker when it must keep re-rendering (during the
 * selected-state spring), because with `tracksViewChanges={false}` the view
 * is a bitmap and animation frames would never paint.
 */
export function PinMarkerView({
  category,
  seeded,
  selected = false,
  photoUri = null,
}: PinMarkerViewProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(selected ? 1.12 : 1, Springs.snap);
  }, [selected, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const fill = seeded ? PIN_GOLD : PIN_AMBER;
  const glyph = seeded ? SEEDED_GLYPH : CATEGORY_GLYPHS[category];
  // A face beats an icon: knowing WHO is going is the reason to tap.
  const showFace = !seeded && photoUri != null;

  return (
    <Animated.View
      // Apple's classic drop-in when a pin appears (new pins and map load
      // alike). Live views on Apple Maps, so the spring actually paints.
      entering={FadeInDown.springify().mass(1).damping(14).stiffness(260)}
      style={[styles.wrap, animatedStyle]}>
      <View style={[styles.body, { backgroundColor: fill }, selected && styles.bodySelected]}>
        {showFace ? (
          <>
            {/* Own clipping layer: the body keeps visible overflow so the
                category badge can sit proud of the ring. */}
            <View style={styles.faceClip}>
              <Image source={{ uri: photoUri }} style={styles.face} contentFit="cover" />
            </View>
            {/* Category still readable at a glance, tucked in the corner. */}
            <View style={[styles.categoryDot, { backgroundColor: fill }]}>
              <SymbolView name={glyph} size={8} tintColor={PIN_GLYPH} />
            </View>
          </>
        ) : (
          <SymbolView name={glyph} size={15} tintColor={PIN_GLYPH} />
        )}
      </View>
      <View style={[styles.tail, { backgroundColor: fill }]} />
    </Animated.View>
  );
}

/**
 * Several plans at one venue, as one marker.
 *
 * Up to three overlapping faces and a count, because "who is going" is the
 * reason to tap and a number alone answers none of it. Three separate
 * markers on the same building put two of them permanently under the third,
 * where nobody could reach them.
 */
export function PinStackView({
  faces,
  count,
  category,
  selected = false,
}: {
  /** Photo URLs, already resolved. Nulls become the anonymous silhouette. */
  faces: (string | null)[];
  count: number;
  category: PinCategory;
  selected?: boolean;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(selected ? 1.12 : 1, Springs.snap);
  }, [selected, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const shown = faces.slice(0, STACK_FACES);

  return (
    <Animated.View
      entering={FadeInDown.springify().mass(1).damping(14).stiffness(260)}
      style={[styles.wrap, animatedStyle]}>
      <View style={styles.stackRow}>
        {shown.map((uri, index) => (
          <View
            key={index}
            style={[
              styles.stackFace,
              { backgroundColor: PIN_AMBER, marginLeft: index === 0 ? 0 : -STACK_OVERLAP },
              // Later faces paint over earlier ones, which is what makes the
              // overlap read as a stack rather than as a smudge.
              { zIndex: STACK_FACES - index },
            ]}>
            {uri ? (
              <Image source={{ uri }} style={styles.face} contentFit="cover" />
            ) : (
              <SymbolView name={CATEGORY_GLYPHS[category]} size={13} tintColor={PIN_GLYPH} />
            )}
          </View>
        ))}
        <View style={[styles.stackCount, { backgroundColor: PIN_AMBER }]}>
          <Text style={styles.stackCountText}>{count > 99 ? '99+' : count}</Text>
        </View>
      </View>
      <View style={[styles.tail, { backgroundColor: PIN_AMBER }]} />
    </Animated.View>
  );
}

/**
 * The whole city as one marker, once the map is zoomed past street scale.
 *
 * It used to borrow PinStackView with a single anonymous silhouette, which
 * said "somebody, and a number" - and the number was the only true part. The
 * research asked for the city NAMED with its count ("Bangkok · 12 plans"),
 * because at that zoom the question is which city has anything going on, not
 * who is in this one. A pill rather than a teardrop for the same reason: it
 * is a label, not a place.
 */
export function CityCountView({ name, count }: { name: string; count: number }) {
  return (
    <Animated.View
      entering={FadeInDown.springify().mass(1).damping(14).stiffness(260)}
      style={styles.wrap}>
      <View style={styles.cityPill}>
        <Text style={styles.cityName}>{name}</Text>
        <View style={styles.cityDot} />
        <Text style={styles.cityCount}>{count}</Text>
      </View>
      <View style={[styles.tail, { backgroundColor: PIN_AMBER }]} />
    </Animated.View>
  );
}

/**
 * The marker's face, off the map: the same amber disc and the same category
 * glyph, at a size a card can carry.
 *
 * Cards and forms used to label a plan with the category EMOJI, which broke
 * the line from marker to card twice over — a sticker where the map has
 * cartography, and (for the catch-all category) a red pushpin, the one hue
 * this palette does not use anywhere else.
 */
export function PinGlyph({
  category,
  seeded = false,
  size = 30,
}: {
  category: PinCategory;
  seeded?: boolean;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.glyphDisc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: seeded ? PIN_GOLD : PIN_AMBER,
        },
      ]}>
      <SymbolView
        name={seeded ? SEEDED_GLYPH : CATEGORY_GLYPHS[category]}
        size={Math.round(size * 0.46)}
        tintColor={PIN_GLYPH}
      />
    </View>
  );
}

/**
 * Marker rasterization control: track view changes briefly on mount (so the
 * glyph is in the bitmap) and around every selected-state change (so the
 * spring actually paints), then freeze for map-pan performance.
 */
export function useMarkerTracking(key: string): boolean {
  const [tracking, setTracking] = useState(true);
  // Re-arm during render when the key changes (selection flip, or a photo
  // finally resolving) — the sanctioned "storing information from previous
  // renders" pattern.
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
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

// 36, not 34. On a muted basemap the face is the only thing worth looking at,
// and at 34 with a badge on its corner there was more chrome than person.
const BODY = 36;
const TAIL = 11;
/** How many faces a stack shows before the count takes over. */
const STACK_FACES = 3;
const STACK_FACE = 28;
const STACK_OVERLAP = 10;

const styles = StyleSheet.create({
  stackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 2,
  },
  stackFace: {
    width: STACK_FACE,
    height: STACK_FACE,
    borderRadius: STACK_FACE / 2,
    overflow: 'hidden',
    // Thinner again: three of these overlap, so a heavy ring on each turns a
    // stack of people into a stack of rings.
    borderWidth: 1.5,
    borderColor: PIN_RING,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  stackCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    marginLeft: -6,
    borderWidth: 1.5,
    borderColor: PIN_RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackCountText: {
    color: PIN_GLYPH,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  cityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: PIN_AMBER,
    borderWidth: 2,
    borderColor: PIN_RING,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  cityName: {
    color: PIN_GLYPH,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  cityDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: PIN_GLYPH,
    opacity: 0.5,
  },
  cityCount: {
    color: PIN_GLYPH,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  glyphDisc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrap: {
    alignItems: 'center',
    // Room for the spring overshoot so nothing clips at the bitmap edge.
    padding: 4,
  },
  body: {
    width: BODY,
    height: BODY,
    borderRadius: BODY / 2,
    overflow: 'visible',
    // 2, not 2.5. A thick white ring on a dark ground reads as a sticker
    // stuck onto the map; a thin one reads as the edge of a photograph.
    borderWidth: 2,
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
  faceClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: BODY / 2,
    overflow: 'hidden',
  },
  face: {
    width: '100%',
    height: '100%',
  },
  /*
   * Small, and sitting OUTSIDE the face rather than on it.
   *
   * At 16pt with its own 1.5pt ring this was 47% of the marker's diameter and
   * landed across the chin of every photo — two rings and two discs where the
   * eye wanted one person. The plan still has to be readable at a glance
   * (the person is attached to the plan, not the reverse), so the badge
   * stays; it just stops competing with the face for the same pixels.
   */
  categoryDot: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 1,
    borderColor: PIN_RING,
    alignItems: 'center',
    justifyContent: 'center',
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
