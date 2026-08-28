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
 * A place on the map, and the whole point of it is that it reads quieter than
 * a traveler.
 *
 * People stack on top of places: the bar is the ground, the plan is the news.
 * So this is 26pt against the traveler pin's 36, a flat chip rather than a
 * teardrop with a tail, the app's own surface navy rather than the warm amber
 * that means "somebody", and it yields both its z-order and Apple's collision
 * pass to the pins above it.
 *
 * Colours come from the theme where the traveler pin hardcodes them, and that
 * is not a drift. The pin is warm light that has to hold against any basemap;
 * a place is deliberately the same navy as the app's own cards, and Nocturne
 * is dark-only, so the token is one value in either scheme.
 */

/** 26pt, from docs/BUSINESS_ACCOUNTS.md §4. */
const CHIP = 26;
const GLYPH = 13;
const RING = 1.5;

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
}: {
  category: BusinessCategory;
  /** Something posted. It brightens the RING, and nothing else. */
  live?: boolean;
  size?: number;
  /**
   * Drawn on one of the app's own surfaces rather than on the basemap. The
   * chip is surface navy, and a sheet IS surface navy, so without this it
   * would be a ring around nothing.
   */
  onSurface?: boolean;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.chip,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: onSurface ? theme.surfaceSunken : theme.surface,
          // The only difference a live post makes. A bigger marker would let
          // a place shout over the people standing on it, and a gold star
          // already means "one of our picks" on this map.
          borderColor: live ? theme.highlight : theme.border,
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
              borderColor: onSurface ? theme.surfaceSunken : theme.surface,
            },
          ]}
        />
      ) : null}
      <SymbolView
        // vocabulary.ts types the glyph map as plain strings so it can be
        // imported by code that never renders one; SymbolView wants the SF
        // Symbols union. The names themselves are checked there.
        name={CATEGORY_ICON[category] as SymbolViewProps['name']}
        size={Math.round(size * (GLYPH / CHIP))}
        tintColor={theme.textSecondary}
      />
    </View>
  );
}

export function BusinessMarker({
  business,
  onPress,
}: {
  business: CityBusinessRow;
  onPress: () => void;
}) {
  // The rasterization window every marker on this map holds: track briefly so
  // the glyph and the entrance land in the bitmap, then freeze so a pan is
  // not a re-render per frame.
  const tracking = useMarkerTracking(`${business.id}:${business.has_live_post}`);

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
        business.name,
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
        <PlaceGlyph category={business.category} live={business.has_live_post} />
      </Animated.View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    // Room for the ring's glow inside the bitmap, and symmetric so the chip
    // stays centred on its coordinate. Nine rather than four, because a
    // marker's tappable area IS this view: 26 + 9 + 9 is 44, and 26 + 4 + 4
    // was 34 — under the floor, on a map where the thing next to it is a
    // 36pt pin with a tail.
    padding: 9,
  },
  liveDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1,
  },
  chip: {
    ...Elevation.raised,
    borderWidth: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
