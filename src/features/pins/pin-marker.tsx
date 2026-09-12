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
import { useTheme } from '@/hooks/use-theme';
import type { PinCategory } from '@/lib/database.types';
import { photoSource } from '@/lib/photo-source';

import { MARK_AMBER, MARK_AMBER_LATER, MARK_INK, MARK_RING } from './marker-colors';

/**
 * One glyph per category, drawn ink-on-amber on the pin body. Emoji markers
 * read as stickers on a basemap; template glyphs read as cartography
 * (docs/DESIGN.md).
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

/** What every one of our own picks wears, and nothing else does. */
const SEEDED_GLYPH: SymbolViewProps['name'] = { ios: 'star.fill', android: 'star', web: 'star' };

/**
 * What a marker wears when the plans behind it disagree about category: a
 * neutral pin from the same mappin family the dock's Drop-a-pin control
 * draws, rather than borrowing the first pin's category and lying about the
 * rest.
 *
 * Currently unreachable on the map — every stacked marker carries a COUNT
 * now, and a count pin draws no glyph at all — but glyphFor stays total so
 * the type has no hole and a stack drawn without a count cannot render an
 * undefined symbol.
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

// 36, not 34. The body carries the category glyph or the count, and at 34
// with a badge on each corner there was more chrome than mark.
const BODY = 36;
/**
 * 16, was 11, and squeezed on the screen's X axis (see styles.tail): Apple's
 * POI marks are always flat discs, so the lengthened teardrop neck is the
 * silhouette that separates our markers where hue never could.
 */
const TAIL = 16;
/** How much of the tail's layout box tucks up behind the body. */
const TAIL_TUCK = TAIL / 2 + 4;
/**
 * Room for the spring overshoot and for the own-pin ring, so nothing clips at
 * the bitmap edge. 6, was 4: the ring now has to clear a body that can also
 * be a stadium, and the selected spring reaches 1.12.
 */
const WRAP_PAD = 6;

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
 * The city pill is a label, not a teardrop, and it is shorter than a pin
 * body: 13pt text at lineHeight 16 with 6+6 padding and 2+2 of border is 32.
 *
 * Derived from that number rather than from a marker's, because it is the
 * only thing that uses it. At maxFontSizeMultiplier 1.3 the pill grows and
 * the tip drifts about 2.5pt, which at a zoom spanning tens of kilometres is
 * a fraction of a pixel of map.
 */
export const CITY_PILL_CENTER_OFFSET = centerOffsetFor(32);

/** The two families that wear a teardrop. */
export type MarkKind = 'plan' | 'pick';

type PinMarkProps = {
  kind: MarkKind;
  /** Body diameter. 36 on the map; 16 in the key, 22 in the filters sheet. */
  size?: number;
  /**
   * The category glyph on the body. Omitted for key and sheet art, where the
   * mark stands for the whole FAMILY and a category would be a lie about it,
   * and ignored entirely when `count` is set.
   */
  category?: StackCategory;
  /** Several plans behind one mark. Replaces the glyph and never the face. */
  count?: number | null;
  /** The plan is open to join. A badge, not a third marker colour. */
  open?: boolean;
  /** The viewer's own plan: a concentric accent ring, a shape not a hue. */
  own?: boolean;
  /** A later day than the browsed city's today: one step dimmer. */
  later?: boolean;
  selected?: boolean;
  /**
   * The poster's profile photo, as a corner badge. Present only for signed-in
   * viewers: the server strips identity from a guest's pin feed. Ignored on a
   * count pin, where one face for three people would be a lie.
   */
  photoUri?: string | null;
  /**
   * The face's storage path, as expo-image's cache key (lib/photo-source):
   * a signed URL changes every launch, the bytes behind it never do.
   */
  photoPath?: string | null;
  /**
   * The face's bytes have landed. The map's marker puts this in its
   * rasterisation key, because the URL resolves well before the download
   * and a window that closed on the URL froze an empty badge.
   */
  onFaceLoad?: () => void;
};

/**
 * The mark itself, with no animation and no map in it.
 *
 * Both families share one silhouette and separate on FILL versus VOID: a plan
 * is a solid amber teardrop with a white ring, one of our picks is the same
 * teardrop inverted — ink body, amber ring, amber star. That is what retired
 * gold from the map. Amber against gold measured 1.31:1 and the white ring
 * meant to carve them apart was 1.61:1 against gold, so the two families were
 * separating on hue and a 15pt glyph and nothing else. Fill versus void
 * survives a green park, arm's length and colour blindness, where hue cannot.
 *
 * Every dimension scales from `size`, so the key, the filters sheet and the
 * map draw the same artwork and cannot drift apart.
 */
export function PinMark({
  kind,
  size = BODY,
  category,
  count = null,
  open = false,
  own = false,
  later = false,
  selected = false,
  photoUri = null,
  photoPath = null,
  onFaceLoad,
}: PinMarkProps) {
  const theme = useTheme();
  const s = size / BODY;

  const pick = kind === 'pick';
  // The later-day dim is the amber's alone. One of our picks is never "later"
  // — it has no day of its own to be later than.
  const fill = pick ? MARK_INK : later ? MARK_AMBER_LATER : MARK_AMBER;
  const ink = pick ? MARK_AMBER : MARK_INK;
  // The pick's amber ring IS its edge, so it carries no white one; a plan's
  // white ring is what carves it out of its own heat glow at roughly 10:1.
  const ringColor = pick ? MARK_AMBER : MARK_RING;
  const ringWidth = (pick ? 2.5 : 2) * s + (selected ? 1 : 0);
  const glyphSize = Math.round(15 * s);
  const tail = TAIL * s;
  const tailTuck = TAIL_TUCK * s;

  const counted = count != null;
  const glyph = pick ? SEEDED_GLYPH : category != null ? glyphFor(category) : null;
  // A face is never drawn on a count pin: three people and one photograph is
  // a marker that names the wrong person. A plain Image, deliberately not
  // RemoteImage: a pulse inside a rasterised marker is either frozen or
  // keeps every marker tracking; the badge is simply absent until the bytes
  // land, and onFaceLoad is how the marker learns they have.
  const face = !pick && !counted ? photoSource(photoUri, photoPath) : null;

  const badge = Math.round(13 * s);
  const faceSize = Math.round(14 * s);

  return (
    <View style={[styles.wrap, { padding: WRAP_PAD * s }]}>
      {own ? (
        // Under the tail (zIndex), so the neck reads as passing behind the
        // ring rather than being cut by it.
        <View
          pointerEvents="none"
          style={[
            styles.ownRing,
            {
              width: size + WRAP_PAD * s * 2,
              height: size + WRAP_PAD * s * 2,
              borderRadius: (size + WRAP_PAD * s * 2) / 2,
              borderWidth: 2 * s,
              borderColor: theme.accent,
            },
          ]}
        />
      ) : null}
      <View
        style={[
          styles.body,
          {
            // A stadium when it carries a count, so three digits and a 1.3x
            // text scale widen the body instead of clipping inside it.
            minWidth: size,
            height: size,
            borderRadius: size / 2,
            paddingHorizontal: counted ? 8 * s : 0,
            backgroundColor: fill,
            borderWidth: ringWidth,
            borderColor: ringColor,
          },
          selected && styles.bodySelected,
        ]}>
        {counted ? (
          <Text
            // Marker artwork is cartography, but a number a person has to
            // READ is not exempt from Dynamic Type. Capped rather than
            // refused: the body is a stadium, so it grows with the digits.
            maxFontSizeMultiplier={1.3}
            style={[styles.countText, { color: ink, fontSize: Math.round(15 * s) }]}>
            {count > 99 ? '99+' : count}
          </Text>
        ) : glyph != null ? (
          <SymbolView name={glyph} size={glyphSize} tintColor={ink} />
        ) : null}
        {face != null ? (
          // Sitting proud of the body's corner rather than filling it. The
          // body always carries the category or the count, so a guest, a
          // business viewer and a signed-in traveler finally read one
          // silhouette — which is the precondition for a four-mark key being
          // true at all. Faces still lead the card that opens on tap.
          <View
            style={[
              styles.faceBadge,
              {
                right: -3 * s,
                bottom: -3 * s,
                width: faceSize,
                height: faceSize,
                borderRadius: faceSize / 2,
                borderWidth: 1.5 * s,
                borderColor: MARK_RING,
              },
            ]}>
            <Image source={face} style={styles.faceImage} contentFit="cover" onLoad={onFaceLoad} />
          </View>
        ) : null}
        {open ? (
          <View
            style={[
              styles.openDot,
              {
                left: -3 * s,
                top: -3 * s,
                width: badge,
                height: badge,
                borderRadius: badge / 2,
                borderWidth: 1 * s,
                borderColor: MARK_RING,
                backgroundColor: fill,
              },
            ]}>
            <SymbolView
              name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
              size={Math.round(8 * s)}
              tintColor={ink}
            />
          </View>
        ) : null}
      </View>
      <View
        style={[
          styles.tail,
          {
            width: tail,
            height: tail,
            marginTop: -tailTuck,
            // SOLID amber on a pick too: a 16pt hollow neck vanishes at
            // marker size, and the teardrop is the silhouette that separates
            // our marks from Apple's flat POI discs.
            backgroundColor: pick ? MARK_AMBER : fill,
          },
        ]}
      />
    </View>
  );
}

type PinMarkerViewProps = Omit<PinMarkProps, 'kind' | 'category'> & {
  category?: StackCategory;
  /** One of our own picks rather than a traveler's plan. */
  seeded: boolean;
};

/**
 * The mark on the map: PinMark plus the entrance and the selected spring.
 *
 * Live views on the Apple path (see useMarkerTracking), so the springs
 * genuinely paint rather than being frozen into a bitmap.
 */
export function PinMarkerView({ seeded, selected = false, ...mark }: PinMarkerViewProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(selected ? 1.12 : 1, Springs.snap);
  }, [selected, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      // Apple's classic drop-in when a pin appears (new pins and map load
      // alike).
      entering={FadeInDown.springify().mass(1).damping(14).stiffness(260)}
      style={animatedStyle}>
      <PinMark kind={seeded ? 'pick' : 'plan'} selected={selected} {...mark} />
    </Animated.View>
  );
}

/**
 * The whole city as one marker, once the map is zoomed past street scale.
 *
 * It used to borrow the stacked marker with a single anonymous silhouette,
 * which said "somebody, and a number" - and the number was the only true
 * part. The research asked for the city NAMED with its count ("Bangkok · 12
 * plans"), because at that zoom the question is which city has anything going
 * on, not who is in this one. A pill rather than a teardrop for the same
 * reason: it is a label, not a place.
 */
export function CityCountView({ name, count }: { name: string; count: number }) {
  return (
    <Animated.View
      entering={FadeInDown.springify().mass(1).damping(14).stiffness(260)}
      style={styles.wrapDefault}>
      <View style={styles.cityPill}>
        {/* Capped, not refused: a pill is a label a person reads, and
            CITY_PILL_CENTER_OFFSET's comment carries what the growth costs
            at this zoom. */}
        <Text maxFontSizeMultiplier={1.3} style={styles.cityName}>
          {name}
        </Text>
        <View style={styles.cityDot} />
        <Text maxFontSizeMultiplier={1.3} style={styles.cityCount}>
          {count}
        </Text>
      </View>
      <View style={[styles.tail, styles.cityTail]} />
    </Animated.View>
  );
}

/**
 * The marker's face, off the map: the same disc and the same glyph, at a size
 * a card can carry.
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
  const theme = useTheme();
  return (
    <View
      style={[
        styles.glyphDisc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          // Hollow for a pick, the same inversion the map draws. Its body is
          // surfaceSunken rather than the map's canvas, because a card sits
          // on a surface and canvas-on-surface measures 1.24:1; the amber
          // ring and star carry it at 9:1 either way.
          backgroundColor: seeded ? theme.surfaceSunken : MARK_AMBER,
          borderWidth: seeded ? Math.max(2, (size * 2.5) / 36) : 0,
          borderColor: MARK_AMBER,
        },
      ]}>
      <SymbolView
        name={seeded ? SEEDED_GLYPH : CATEGORY_GLYPHS[category]}
        size={Math.round(size * 0.46)}
        tintColor={seeded ? MARK_AMBER : MARK_INK}
      />
    </View>
  );
}

/**
 * Marker re-render control.
 *
 * NOT rasterization, on the platform this app ships: `tracksViewChanges` is
 * implemented for iOS GOOGLE Maps and for Android only in
 * react-native-maps 1.27.2 — it is absent from every file under ios/AirMaps
 * and documented '@platform iOS: Google Maps only' at
 * node_modules/react-native-maps/src/MapMarker.tsx:308-316. This app is
 * PROVIDER_DEFAULT, so the Apple path mounts the marker's React child as a
 * live subview and never snapshots it: springs and entrances paint
 * unconditionally and there is no pan-time freeze being bought here.
 *
 * The hook stays for Android correctness, and its KEYS stay as the project's
 * own checklist of everything a marker draws — anything missing from a key is
 * something that would be missing from the bitmap on the provider that does
 * freeze.
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
  cityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: MARK_AMBER,
    borderWidth: 2,
    borderColor: MARK_RING,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  cityName: {
    color: MARK_INK,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  cityDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: MARK_INK,
    opacity: 0.5,
  },
  cityCount: {
    color: MARK_INK,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  cityTail: {
    width: TAIL,
    height: TAIL,
    marginTop: -TAIL_TUCK,
    backgroundColor: MARK_AMBER,
  },
  glyphDisc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrap: {
    alignItems: 'center',
  },
  wrapDefault: {
    alignItems: 'center',
    padding: WRAP_PAD,
  },
  /**
   * The viewer's own pin: a concentric accent ring living INSIDE the wrap
   * padding, absolutely positioned so the marker's layout — and with it the
   * derived centre offset — does not move a point. Same argument as
   * business-marker.tsx's own-ring: a shape, not a hue swap.
   */
  ownRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: -2,
  },
  body: {
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  /** Deeper but TIGHTER, so the lift fits inside the 6pt wrap padding. */
  bodySelected: {
    shadowOpacity: 0.35,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  countText: {
    fontWeight: '800',
  },
  faceBadge: {
    position: 'absolute',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceImage: {
    width: '100%',
    height: '100%',
  },
  openDot: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tail: {
    borderRadius: 2,
    // A rotated square squeezed on the screen's X axis: the diamond becomes
    // a teardrop neck. The scale is OUTSIDE the rotate (first in the array,
    // CSS ordering), so the squeeze is horizontal on screen and the tip's Y
    // — which centerOffsetFor() derives — is untouched.
    transform: [{ scaleX: 0.62 }, { rotate: '45deg' }],
    zIndex: -1,
  },
});
