import { StyleSheet, View } from 'react-native';

import { heatRings } from './heat';
import { MARK_INK } from './marker-colors';

/**
 * The busy-areas mark, off the map.
 *
 * Built from heatRings() itself rather than drawn by hand, which is the whole
 * point of the file: the swatch was a single `rgba(255, 154, 90, 0.85)`
 * literal copied into three places, and it had drifted to roughly three times
 * the alpha the layer has ever painted. A key that lies about a mark is worse
 * than no key. Now the three nested discs carry the real per-ring alpha and
 * composite the same way the map's circles do, so the swatch changes when the
 * layer does or not at all.
 *
 * Count 3 because that is the lowest count that ever renders: heat_k is
 * CHECKed >= 3 in the schema, so a swatch drawn at count 1 would show an
 * intensity the map cannot produce.
 */
const SAMPLE_COUNT = 3;

/** Scales matching RING_SCALES, as fractions of the swatch's own diameter. */
const RING_FRACTIONS = [1, 0.7, 0.4];

export function HeatSwatch({ size = 22 }: { size?: number }) {
  const rings = heatRings({ key: 'swatch', lat: 0, lng: 0, count: SAMPLE_COUNT });
  return (
    // The ink disc under it is the basemap: a translucent glow on nothing
    // renders against whatever surface it lands on, which is exactly how the
    // old swatch came to be four times too bright to match the map.
    <View
      style={[
        styles.ground,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: MARK_INK },
      ]}>
      {rings.map((ring, index) => {
        const diameter = size * RING_FRACTIONS[index];
        return (
          <View
            key={ring.key}
            style={[
              styles.ring,
              {
                width: diameter,
                height: diameter,
                borderRadius: diameter / 2,
                backgroundColor: ring.fill,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  ground: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
  },
});
