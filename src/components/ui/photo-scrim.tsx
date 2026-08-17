import { LinearGradient } from 'expo-linear-gradient';
import { type DimensionValue, StyleSheet } from 'react-native';

// Eased rather than linear: a straight ramp reads as a grey haze across the
// middle of the photo, while this keeps the image clean until it has to darken.
const COLORS = [
  'rgba(8,10,9,0)',
  'rgba(8,10,9,0.10)',
  'rgba(8,10,9,0.34)',
  'rgba(8,10,9,0.72)',
] as const;
const LOCATIONS = [0, 0.45, 0.75, 1] as const;

/**
 * A bottom-up dark gradient so white overlay text clears 4.5:1 over an
 * arbitrary photo (docs/DESIGN.md contrast floor). Purely decorative — it
 * never intercepts touches from the photo underneath.
 */
export function PhotoScrim({ height = '60%' }: { height?: DimensionValue }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={COLORS}
      locations={LOCATIONS}
      style={[styles.scrim, { height }]}
    />
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
