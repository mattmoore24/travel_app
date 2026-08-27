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
}: {
  category: BusinessCategory;
  /** Something posted. It brightens the RING, and nothing else. */
  live?: boolean;
  size?: number;
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
          backgroundColor: theme.surface,
          // The only difference a live post makes. A bigger marker would let
          // a place shout over the people standing on it, and a gold star
          // already means "one of our picks" on this map.
          borderColor: live ? theme.highlight : theme.border,
        },
        live && { shadowColor: theme.highlight, shadowOpacity: 0.5, shadowRadius: 6 },
      ]}>
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
      // Beneath every traveler pin, in both senses. `zIndex` orders the draw;
      // `low` lets MapKit drop a place first when a corner is crowded, which
      // is the right thing to lose.
      zIndex={0}
      displayPriority="low"
      tracksViewChanges={tracking}
      accessibilityRole="button"
      // Never "business": that word is back-office only. And "something on"
      // rather than "tonight", because the flag says a post exists, not when
      // it happens.
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
    // stays centred on its coordinate.
    padding: 4,
  },
  chip: {
    ...Elevation.raised,
    borderWidth: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
