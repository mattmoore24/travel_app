import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Elevation, Motion } from '@/constants/theme';
import { CATEGORY_ICON, CATEGORY_LABEL } from '@/features/business/vocabulary';
import { useMarkerTracking } from '@/features/pins/pin-marker';
import { useTheme } from '@/hooks/use-theme';
import type { BusinessCategory, CityBusinessRow } from '@/lib/database.types';

/**
 * A business on the map, and the whole point of it is that it reads quieter
 * than a traveler.
 *
 * People stack on top of businesses: the bar is the ground, the plan is the
 * news. So this is 30pt against the traveler pin's 36, a flat chip rather
 * than a teardrop with a tail, HOLLOW where a plan is solid amber, and it
 * yields both its z-order and Apple's collision pass to the pins above it.
 *
 * Fill versus void is the separation, not hue — the same axis that separates
 * a plan from one of our picks. Quiet is a fill and an outline, never an
 * invisible edge: the old 1.5pt theme.border ring measured 2.80:1 on Apple's
 * washed land, so "quieter than a traveler" had turned into "not on the map".
 */

/**
 * 30pt, was 26 (docs/BUSINESS_ACCOUNTS.md §4). A business is still quieter
 * than a plan — hollow where a plan is solid, a flat chip where a plan has a
 * teardrop neck — but at 26 with a 1.5pt border in theme.border it was not
 * quiet, it was missing. See the ring colour below for the measurement.
 */
const CHIP = 30;
const GLYPH = 15;
const RING = 2;
/** How much wider the owner's halo is than the chip inside it. */
const OWN_RING = 10;

/**
 * Centred on both providers: a chip has no tail, so the marker IS the point.
 * Google reads `anchor`; Apple centres the view already and adds
 * `centerOffset`, which is zero here and therefore left off.
 */
const CHIP_ANCHOR = { x: 0.5, y: 0.5 };

/**
 * The chip artwork, off the map as well as on it, so the sheet that opens can
 * lead with the same object you just tapped rather than with a new one.
 */
export function PlaceGlyph({
  category,
  live = false,
  size = CHIP,
  onSurface = false,
  own = false,
  glyph,
}: {
  category: BusinessCategory;
  /** Something posted. It brightens the RING, and nothing else. */
  live?: boolean;
  size?: number;
  /**
   * Drawn on one of the app's own surfaces rather than on the basemap. The
   * chip's body is the map's ground, and a sheet is not, so without this it
   * would be canvas on surface at 1.24:1 — a ring around nothing.
   */
  onSurface?: boolean;
  /**
   * The viewer's own listing. An owner opening the map could not tell their
   * business from the four rivals on the same street: every chip was drawn
   * identically, so the one marker they came to see was the one they had to
   * hunt for.
   */
  own?: boolean;
  /**
   * Override the category glyph. Used by the map key and the filters sheet
   * ONLY, where the chip stands for the whole family: the key used to show a
   * wineglass, which is the glyph a bar PLAN wears one row above it.
   */
  glyph?: SymbolViewProps['name'];
}) {
  const theme = useTheme();

  const chip = (
    <View
      style={[
        styles.chip,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          // HOLLOW: the map's ground rather than a card's, so the chip reads
          // as a hole cut in the basemap next to a plan's solid amber. On one
          // of the app's own surfaces it keeps surfaceSunken, because canvas
          // on surface measures 1.24:1 and would be a ring around nothing.
          backgroundColor: onSurface ? theme.surfaceSunken : theme.canvas,
          // The only difference a live post makes. A bigger marker would let
          // a business shout over the people standing on it.
          //
          // textSecondary, NOT theme.border, and that is measured: border is
          // the app's own "edge a user must see" at 3.4:1 on the app's ground,
          // but Apple's washed dark land is lighter than canvas and it lands
          // at 2.80:1 there — under the 3:1 floor for a UI edge, which is why
          // a business was something you hunted for. textSecondary is 6.77:1
          // on the same land.
          borderColor: live ? theme.highlight : theme.textSecondary,
        },
        live && { shadowColor: theme.highlight, shadowOpacity: 0.5, shadowRadius: 6 },
      ]}>
      {/* Not hue alone. The ring going warm is the signal, and on a basemap
          full of colour a hue change is exactly what somebody who cannot
          separate those two hues gets nothing from. The dot is the second
          channel: a shape that is either there or not. */}
      {live ? (
        <View
          style={[
            styles.liveDot,
            {
              backgroundColor: theme.highlight,
              // Its border is whatever ground the chip sits in, so the dot
              // reads as punched out of the chip rather than stuck onto it.
              borderColor: onSurface ? theme.surfaceSunken : theme.canvas,
            },
          ]}
        />
      ) : null}
      <SymbolView
        // vocabulary.ts types the glyph map as plain strings so it can be
        // imported by code that never renders one; SymbolView wants the SF
        // Symbols union. The names themselves are checked there.
        name={glyph ?? (CATEGORY_ICON[category] as SymbolViewProps['name'])}
        size={Math.round(size * (GLYPH / CHIP))}
        tintColor={theme.textSecondary}
      />
    </View>
  );

  if (!own) {
    return chip;
  }
  // A second ring, concentric, in the brand blue. A SHAPE around the chip
  // rather than a different colour of chip: hue alone is what the live dot
  // exists to avoid repeating, and the halo is still legible when the ring
  // underneath it has gone warm because there is something on tonight. It
  // sits inside the marker's own 7pt padding, so nothing moves off its
  // coordinate.
  return (
    <View
      style={[
        styles.ownRing,
        {
          width: size + OWN_RING,
          height: size + OWN_RING,
          borderRadius: (size + OWN_RING) / 2,
          borderColor: theme.accent,
        },
      ]}>
      {chip}
    </View>
  );
}

export function BusinessMarker({
  business,
  own = false,
  onPress,
}: {
  business: CityBusinessRow;
  /** This is the viewer's own listing. See PlaceGlyph's `own`. */
  own?: boolean;
  onPress: () => void;
}) {
  // The rasterization window every marker on this map holds: track briefly so
  // the glyph and the entrance land in the bitmap, then freeze so a pan is
  // not a re-render per frame.
  //
  // `own` is in the key because the chips arrive before the answer does.
  // The account-kind query is already resolved by the time this mounts (the
  // root holds the navigator behind `businessSettled`, _layout.tsx), but
  // useCityBusinesses is not: markers paint as that query lands, and a chip
  // rasterized in the tick before `own` reaches it would freeze as a bitmap
  // with no halo on it, forever.
  const tracking = useMarkerTracking(`${business.id}:${business.has_live_post}:${own}`);

  return (
    <Marker
      coordinate={{ latitude: business.lat, longitude: business.lng }}
      anchor={CHIP_ANCHOR}
      // Beneath every traveler pin. `zIndex` plus declaration order is what
      // does that, and it is ALL that should: layering is a drawing question.
      //
      // NOT displayPriority="low", which is what shipped and which meant no
      // place was ever drawn at all. That prop is MapKit's DECLUTTERING
      // control, it defaults to 'required', and 'low' means "hide this
      // whenever it would collide with anything higher". Every traveler pin
      // is higher, and so is every one of Apple's own POI labels — which this
      // map deliberately keeps, at the founder's request, and which blanket a
      // city. So every chip lost every collision, everywhere, and a
      // decluttered annotation leaves the accessibility tree with it, which
      // is why the simulator suite could not tap one either.
      zIndex={0}
      tracksViewChanges={tracking}
      accessibilityRole="button"
      // "something on" rather than "tonight", because the flag says a post
      // exists, not when it happens.
      accessibilityLabel={[
        own ? `Your business, ${business.name}` : business.name,
        CATEGORY_LABEL[business.category],
        business.has_live_post ? 'something on' : null,
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={(event) => {
        // Or the map's own press handler runs as well and closes what this
        // tap just opened.
        event.stopPropagation();
        onPress();
      }}>
      <Animated.View
        // A place is already there; it does not arrive. So it fades in where
        // a traveler's pin drops in.
        entering={FadeIn.duration(Motion.standard)}
        style={styles.wrap}>
        <PlaceGlyph category={business.category} live={business.has_live_post} own={own} />
      </Animated.View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    // Room for the ring's glow inside the bitmap, and symmetric so the chip
    // stays centred on its coordinate. A marker's tappable area IS this view,
    // so the padding is whatever holds the 44pt floor: 30 + 7 + 7 is 44, as
    // 26 + 9 + 9 was before the chip grew.
    padding: 7,
  },
  liveDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  chip: {
    ...Elevation.raised,
    borderWidth: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownRing: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
