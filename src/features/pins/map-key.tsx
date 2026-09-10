import { PixelRatio, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, Radius, Space } from '@/constants/theme';
import { PlaceGlyph } from '@/features/business/business-marker';
import { ALL_MARKER_KINDS, type MarkerKind } from '@/features/pins/filters';
import { useTheme } from '@/hooks/use-theme';

import { HeatSwatch } from './heat-swatch';
import { PinMark } from './pin-marker';

/**
 * A neutral shopfront rather than a category. The key stands for the whole
 * family, and the old legend showed a wineglass — which is the glyph a bar
 * PLAN wears one row above it.
 */
const BUSINESS_GLYPH = { ios: 'storefront', android: 'storefront', web: 'storefront' } as const;

/** One word per family. Nothing else is printed: no sentence, no count. */
function wordFor(kind: MarkerKind, viewerIsBusiness: boolean): string {
  switch (kind) {
    case 'travelers':
      // An owner's own chips are on this map too, so "plans" alone would be
      // ambiguous about whose.
      return viewerIsBusiness ? 'Traveler plans' : 'Plans';
    case 'businesses':
      return 'Businesses';
    case 'picks':
      return 'Picks';
    case 'heat':
      // Never "Busy" on its own: an unqualified busy claim reads as a
      // presence claim, and this layer is scoped to a city that may be a
      // continent away.
      return 'Busy areas';
  }
}

function ArtFor({ kind, size }: { kind: MarkerKind; size: number }) {
  switch (kind) {
    case 'travelers':
      // No category glyph: the glyph is the category, not the family.
      return <PinMark kind="plan" size={size} />;
    case 'businesses':
      return (
        <PlaceGlyph category="other" live={false} size={size} onSurface glyph={BUSINESS_GLYPH} />
      );
    case 'picks':
      // The star stays, because the star is what every pick shares.
      return <PinMark kind="pick" size={size} />;
    case 'heat':
      return <HeatSwatch size={size} />;
  }
}

/**
 * The map's key: four words and the four marks they name, permanently on the
 * map under the search bar.
 *
 * PERMANENT and non-dismissible, which is the whole point. The two chips this
 * replaces each stored a sixty-day dismissal, so after one read the map had no
 * key on it at all — and a map whose marks are only explained once is a map
 * with no key.
 *
 * NOT an entry in SLOT_ORDER, deliberately. That strip is single-occupant by
 * construction (message-slot.ts), so a permanent tenant there would silence
 * pins-error, heat-error, own-listing, both empty states and both arrival
 * banners. And opening Filters clears the strip anyway, so a key living in it
 * could never be on screen at the moment its own explanation opened.
 *
 * The art comes from the map's own components at a smaller size rather than
 * being drawn again here, so the key cannot drift from what the map paints.
 */
export function MapKey({
  kinds,
  viewerIsBusiness,
  onPress,
}: {
  /** The families currently ticked. Unticking one removes its mark AND its word. */
  kinds: MarkerKind[];
  viewerIsBusiness: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const shown = ALL_MARKER_KINDS.filter((kind) => kinds.includes(kind));
  const words = shown.map((kind) => wordFor(kind, viewerIsBusiness));

  // Capped scale, the idiom the map's other measured chrome uses: the marks
  // are artwork with fixed geometry, so they grow with Dynamic Type up to a
  // point and then stop. The WORDS beside them are ThemedText and are not
  // capped at all — they scale the whole way, and the chip wraps to hold them.
  const art = Math.round(16 * Math.min(PixelRatio.getFontScale(), 1.5));

  if (shown.length === 0) {
    // Unreachable: the filter sheet's toggle keeps at least one family on.
    // Cheaper than an empty chip if that ever stops being true.
    return null;
  }

  return (
    <PressableScale
      accessibilityRole="button"
      // One element for the whole chip, built by joining the same array it
      // draws so the two cannot drift. Unique against FilterButton's
      // "Filters" and against every marker label on the screen.
      accessibilityLabel={`Map key. ${words.map((word) => word.toLowerCase()).join(', ')}.`}
      accessibilityHint="Opens filters, where each mark is explained"
      containerStyle={styles.press}
      scaleTo={0.97}
      haptic="light"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={onPress}>
      <View style={[styles.chip, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
        {shown.map((kind, index) => (
          <View key={kind} style={styles.pair}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.art, { width: art, height: art }]}>
              <ArtFor kind={kind} size={art} />
            </View>
            <ThemedText type="caption" themeColor="textSecondary">
              {words[index]}
            </ThemedText>
          </View>
        ))}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  press: {
    // Measures to its own words rather than to the screen, so the map keeps
    // every point the key does not need.
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginStart: Space.lg,
    marginTop: Space.sm,
  },
  chip: {
    flexDirection: 'row',
    // At the default size the four pairs are one row about 250pt wide; at the
    // accessibility sizes the chip wraps to as many rows as it needs and the
    // map gives up the room, rather than anything clipping or overlapping.
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Space.md,
    rowGap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...Elevation.raised,
  },
  pair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    // Never squeezed: a pair either fits on this row or moves to the next.
    flexShrink: 0,
  },
  art: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
