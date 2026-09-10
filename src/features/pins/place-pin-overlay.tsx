import { SymbolView } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Springs } from '@/constants/theme';

import { MARK_AMBER, MARK_INK, MARK_RING } from './marker-colors';

const BODY = 44;
const TAIL = 13;
const LIFT = 16;

/**
 * The fixed pin the map pans underneath in place mode (the Uber pickup
 * pattern): the pin's tip marks the exact drop coordinate at screen centre.
 * While the map moves the pin lifts off the ground and a target dot stays
 * behind; when the map settles it drops back with a bounce and a thud.
 * `pointerEvents="none"` throughout — the map below owns every gesture.
 */
export function PlacePinOverlay({
  lifted,
  onDrop,
}: {
  lifted: boolean;
  /**
   * The pin settled back onto the map. The HAPTIC lives with the caller,
   * behind the programmatic-move gate (features/pins/place-mode): the drop
   * motion is informative whoever moved the camera, but the thud means "you
   * placed it here" and must stay silent for the app's own flights.
   */
  onDrop?: () => void;
}) {
  const lift = useSharedValue(0);
  const mounted = useRef(false);

  useEffect(() => {
    // Skip the mount run: the pin starts settled, and a thud before the
    // user has touched anything reads as a glitch.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (lifted) {
      lift.value = withSpring(1, Springs.snap);
    } else {
      lift.value = withSpring(0, Springs.drop);
      onDrop?.();
    }
  }, [lifted, lift, onDrop]);

  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value * LIFT }],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity: lift.value,
    transform: [{ scale: 0.6 + lift.value * 0.4 }],
  }));

  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.centerAnchor}>
        {/* Ground target while the pin is airborne. */}
        <Animated.View style={[styles.groundDot, dotStyle]} />
        <Animated.View style={[styles.pin, pinStyle]}>
          <View style={styles.body}>
            {/* A viewfinder, not a mappin. `mappin` is byte-identical to the
                `other` category's glyph, so a 44pt amber cursor and a 36pt
                amber Other plan were the same mark eight points apart — at
                the exact moment somebody is deciding where a plan goes. A
                crosshair can never be read as a plan. */}
            <SymbolView
              name={{ ios: 'scope', android: 'center_focus_strong', web: 'center_focus_strong' }}
              size={20}
              tintColor={MARK_INK}
            />
          </View>
          <View style={styles.tail} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Zero-size anchor at the exact map centre; children position around it.
  centerAnchor: {
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  pin: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
  },
  body: {
    width: BODY,
    height: BODY,
    borderRadius: BODY / 2,
    borderWidth: 3,
    borderColor: MARK_RING,
    backgroundColor: MARK_AMBER,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  tail: {
    width: TAIL,
    height: TAIL,
    marginTop: -(TAIL / 2 + 5),
    borderRadius: 2.5,
    backgroundColor: MARK_AMBER,
    // Squeezed on the screen's X axis, exactly as every browse marker's tail
    // is: the teardrop neck is the silhouette that separates our marks from
    // Apple's flat POI discs, and it was missing from the one moment a
    // person is looking hardest at a pin.
    transform: [{ scaleX: 0.62 }, { rotate: '45deg' }],
    zIndex: -1,
  },
  groundDot: {
    position: 'absolute',
    bottom: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    // Ink at a little over half, with a light edge. The old near-black at
    // 0.35 measured 1.06:1 against the basemap: the ground target that says
    // "the pin is in the air and this is where it will land" was invisible
    // for the whole of the gesture that needs it.
    backgroundColor: 'rgba(14,16,32,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
});
