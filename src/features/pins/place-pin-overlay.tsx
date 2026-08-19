import { SymbolView } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Springs } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

const PIN_INDIGO = '#2A4C9B';
const PIN_RING = '#FFFFFF';

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
export function PlacePinOverlay({ lifted }: { lifted: boolean }) {
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
      haptics.medium();
    }
  }, [lifted, lift]);

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
            <SymbolView
              name={{ ios: 'mappin', android: 'place', web: 'place' }}
              size={20}
              tintColor={PIN_RING}
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
    borderColor: PIN_RING,
    backgroundColor: PIN_INDIGO,
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
    backgroundColor: PIN_INDIGO,
    transform: [{ rotate: '45deg' }],
    zIndex: -1,
  },
  groundDot: {
    position: 'absolute',
    bottom: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(20,23,26,0.35)',
  },
});
