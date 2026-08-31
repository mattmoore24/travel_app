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
import { isLaterDay } from '@/features/pins/pin-helpers';
import { useTheme } from '@/hooks/use-theme';
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
 * What a stacked marker wears when its plans disagree about category: a
 * neutral pin from the same mappin family the dock's Drop-a-pin control
 * draws, rather than borrowing the first pin's category and lying about the
 * rest of the stack.
 */
const MIXED_GLYPH: SymbolViewProps['name'] = {
  ios: 'mappin.and.ellipse',
  android: 'place',
  web: 'place',
};

/** A stack's category: one of the pin categories, or 'mixed' when they differ. */
export type StackCategory = PinCategory | 'mixed';

const glyphFor = (category: StackCategory): SymbolViewProps['name'] =>
  category === 'mixed' ? MIXED_GLYPH : CATEGORY_GLYPHS[category];

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
 * A plan for a later day burns one step dimmer: PIN_AMBER blended toward the
 * basemap ground, never drawn at alpha (a translucent disc would show the
 * map through it). Two steps only — a 45% amber on this basemap drops the
 * marker under the legibility floor, so the ramp is full or this, nothing
 * lower. Glyph ink on this value still reads at 5.7:1.
 */
const PIN_AMBER_LATER = '#CA784C';

// 36, not 34. On a muted basemap the face is the only thing worth looking
// at, and at 34 with a badge on its corner there was more chrome than
// person.
const BODY = 36;
/**
 * 16, was 11, and squeezed on the screen's X axis (see styles.tail): Apple's
 * POI marks are always flat discs, so the lengthened teardrop neck is the
 * silhouette that separates our markers where hue never could.
 */
const TAIL = 16;
/** How much of the tail's layout box tucks up behind the body. */
const TAIL_TUCK = TAIL / 2 + 4;
/** Room for the spring overshoot so nothing clips at the bitmap edge. */
const WRAP_PAD = 4;
/** How many faces a stack shows before the count takes over. */
const STACK_FACES = 3;
const STACK_FACE = 28;
const STACK_OVERLAP = 10;

/**
 * Marker anchoring is split by provider (verified in react-native-maps
 * types): `anchor` is Google/Android-only; Apple Maps positions the view by
 * its CENTER plus `centerOffset` points. Without the offset every pin tip
 * would sit ~20pt south of its venue on iOS.
 *
 * DERIVED from the geometry, never hardcoded: the old {x:0,y:-20} encoded
 * BODY+TAIL by hand, so any tail change would have drifted every pin tip off
 * its venue — invisible in review and wrong on every marker.
 */
export const MARKER_ANCHOR = { x: 0.5, y: 1 };

function centerOffsetFor(bodyHeight: number): { x: number; y: number } {
  // Layout: wrap padding, the body row, then the tail's box overlapping the
  // body by TAIL_TUCK, then padding again.
  const height = WRAP_PAD * 2 + bodyHeight + (TAIL - TAIL_TUCK);
  // The tip is the rotated square's bottom corner: half the box below the
  // box's centre, then sqrt(2)/2 of the side further for the rotation. The
  // X squeeze changes width only, never the tip's Y.
  const tip = WRAP_PAD + bodyHeight - TAIL_TUCK + TAIL / 2 + (TAIL * Math.SQRT2) / 2;
  return { x: 0, y: -(tip - height / 2) };
}

export const MARKER_CENTER_OFFSET = centerOffsetFor(BODY);
/**
 * A stack's faces are 28pt, so its tip sits nearer its centre than a 36pt
 * body's does. The city pill is within a couple of points of the same height
 * and shares this at a zoom where the difference is invisible.
 */
export const STACK_CENTER_OFFSET = centerOffsetFor(STACK_FACE);

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
  /**
   * The plan is open to join. Drawn as a badge rather than a second marker
   * colour: the map is deliberately two colours (travelers, our picks) and a
   * third would turn it into a legend nobody read.
   */
  open?: boolean;
  /**
   * This is the viewer's own pin. A concentric accent ring, the same shape
   * business-marker.tsx draws for an owner's listing: a SHAPE rather than a
   * hue swap, drawn inside the wrap padding so nothing moves off its
   * coordinate.
   */
  own?: boolean;
  /**
   * The plan's day. Today burns full amber; later days one step dimmer (see
   * PIN_AMBER_LATER). Secondary channel only — the plan list carries the
   * date in words.
   */
  intentDate?: string | null;
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
  open = false,
  own = false,
  intentDate = null,
}: PinMarkerViewProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(selected ? 1.12 : 1, Springs.snap);
  }, [selected, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // The later-day dim applies to the amber only: gold is already the scarce
  // colour, and dimming it would collapse it into amber.
  const later = !seeded && intentDate != null && isLaterDay(intentDate);
  const fill = seeded ? PIN_GOLD : later ? PIN_AMBER_LATER : PIN_AMBER;
  const glyph = seeded ? SEEDED_GLYPH : CATEGORY_GLYPHS[category];
  // A face beats an icon: knowing WHO is going is the reason to tap.
  const showFace = !seeded && photoUri != null;

  return (
    <Animated.View
      // Apple's classic drop-in when a pin appears (new pins and map load
      // alike). Live views on Apple Maps, so the spring actually paints.
      entering={FadeInDown.springify().mass(1).damping(14).stiffness(260)}
      style={[styles.wrap, animatedStyle]}>
      {own ? (
        // Under the tail (zIndex), so the neck reads as passing behind the
        // ring rather than being cut by it.
        <View pointerEvents="none" style={[styles.ownRing, { borderColor: theme.accent }]} />
      ) : null}
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
        {open ? (
          <View style={[styles.openDot, { backgroundColor: fill }]}>
            <SymbolView
              name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
              size={8}
              tintColor={PIN_GLYPH}
            />
          </View>
        ) : null}
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
  intentDate = null,
}: {
  /**
   * Photo URLs, already resolved. Entries that resolved to nothing are
   * DROPPED, not drawn: at launch density nobody has a photo, and a row of
   * identical glyph discs plus a badge was three circles for two plans. When
   * nothing resolves at all, the stack collapses to one glyph disc plus the
   * count, matching the single-marker silhouette.
   */
  faces: (string | null)[];
  count: number;
  /** The cluster's dominant category, or 'mixed' when its plans disagree. */
  category: StackCategory;
  selected?: boolean;
  /** Soonest plan day in the stack; a later-than-today day burns dimmer. */
  intentDate?: string | null;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(selected ? 1.12 : 1, Springs.snap);
  }, [selected, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const shown = faces.slice(0, STACK_FACES);
  const resolved = shown.filter((uri): uri is string => uri != null);
  const later = intentDate != null && isLaterDay(intentDate);
  const fill = later ? PIN_AMBER_LATER : PIN_AMBER;

  return (
    <Animated.View
      entering={FadeInDown.springify().mass(1).damping(14).stiffness(260)}
      style={[styles.wrap, animatedStyle]}>
      <View style={styles.stackRow}>
        {resolved.length === 0 ? (
          <View style={[styles.body, { backgroundColor: fill }]}>
            <SymbolView name={glyphFor(category)} size={15} tintColor={PIN_GLYPH} />
          </View>
        ) : (
          resolved.map((uri, index) => (
            <View
              key={index}
              style={[
                styles.stackFace,
                { backgroundColor: fill, marginLeft: index === 0 ? 0 : -STACK_OVERLAP },
                // Later faces paint over earlier ones, which is what makes
                // the overlap read as a stack rather than as a smudge.
                { zIndex: STACK_FACES - index },
              ]}>
              <Image source={{ uri }} style={styles.face} contentFit="cover" />
            </View>
          ))
        )}
        <View style={[styles.stackCount, { backgroundColor: fill }]}>
          {/* Marker artwork is cartography, not body text: the badge cannot
              grow with Dynamic Type on a view frozen as a bitmap. */}
          <Text allowFontScaling={false} style={styles.stackCountText}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      </View>
      <View style={[styles.tail, { backgroundColor: fill }]} />
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
        {/* Marker artwork is cartography: MapKit's own labels do not scale
            with Dynamic Type either, and this view is frozen as a bitmap. */}
        <Text allowFontScaling={false} style={styles.cityName}>
          {name}
        </Text>
        <View style={styles.cityDot} />
        <Text allowFontScaling={false} style={styles.cityCount}>
          {count}
        </Text>
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
    padding: WRAP_PAD,
  },
  /**
   * The viewer's own pin: a 2pt concentric accent ring living INSIDE the
   * wrap padding, absolutely positioned so the marker's layout — and with it
   * the derived centre offset — does not move a point. Same argument as
   * business-marker.tsx's own-ring: a shape, not a hue swap.
   */
  ownRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BODY + WRAP_PAD * 2,
    height: BODY + WRAP_PAD * 2,
    borderRadius: (BODY + WRAP_PAD * 2) / 2,
    borderWidth: 2,
    zIndex: -2,
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
  openDot: {
    position: 'absolute',
    left: -3,
    top: -3,
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
    marginTop: -TAIL_TUCK,
    borderRadius: 2,
    // A rotated square squeezed on the screen's X axis: the diamond becomes
    // a teardrop neck. The scale is OUTSIDE the rotate (first in the array,
    // CSS ordering), so the squeeze is horizontal on screen and the tip's Y
    // — which centerOffsetFor() derives — is untouched.
    transform: [{ scaleX: 0.62 }, { rotate: '45deg' }],
    zIndex: -1,
  },
});
