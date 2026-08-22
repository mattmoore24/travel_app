import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, SplashField, BrandDeep, Motion, Space, Springs } from '@/constants/theme';
import { useOwnProfile, usePhotoUrl } from '@/features/profile/hooks';
import type { AcceptedMatch } from '@/features/matching/use-accepted-celebration';
import { haptics } from '@/lib/haptics';

/**
 * The warm ring, matched to the map's markers rather than to a value the
 * palette retired. Fixed rather than themed for the same reason the field
 * below is: this is a brand moment and it should look identical everywhere.
 */
const RING = Colors.dark.highlight;

/**
 * The one properly celebratory moment in the app: someone you messaged said
 * yes. The photo pops in over a warm glow, the success haptic lands on the
 * same frame, and the only real action is to go talk to them.
 *
 * Deliberately rare. A decline is silent and a request going out is quiet, so
 * this is the single screen that gets to be loud (docs/DESIGN.md, motion).
 */
export function MatchCelebration({
  match,
  onDismiss,
}: {
  match: AcceptedMatch;
  onDismiss: () => void;
}) {
  const { data: photoUrl } = usePhotoUrl(match.photoPath);
  const scale = useSharedValue(0.5);
  const glow = useSharedValue(0.9);

  useEffect(() => {
    // Overshoot into place, with the haptic timed to the landing.
    scale.value = withSpring(1, Springs.pop);
    glow.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.94, { duration: 1400, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      true
    );
    const timer = setTimeout(() => haptics.success(), 180);
    return () => clearTimeout(timer);
  }, [scale, glow]);

  const { data: profile } = useOwnProfile();
  const photoStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ transform: [{ scale: glow.value }] }));

  return (
    <Animated.View
      entering={FadeIn.duration(Motion.standard)}
      exiting={FadeOut.duration(Motion.quick)}
      // It covers everything, so it has to say so: without this VoiceOver
      // reads through the overlay into the tab behind it.
      accessibilityViewIsModal
      style={styles.root}>
      <Animated.View style={[styles.glowWrap, glowStyle]} pointerEvents="none">
        <Image
          source={require('@/assets/images/logo-glow.png')}
          style={styles.glow}
          contentFit="contain"
        />
      </Animated.View>

      <Animated.View style={[styles.photoWrap, photoStyle]}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" />
        ) : (
          <View style={[styles.photo, styles.photoFallback]} />
        )}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(400).delay(140)} style={styles.text}>
        <ThemedText type="display" style={styles.title}>
          Connected with {match.name}
        </ThemedText>
        <ThemedText style={styles.body}>Your chat is open.</ThemedText>
        {/* The moment verification is worth something. This app ends in two
            strangers meeting in a real city, so the badge is spent exactly
            here — and asking now, when somebody has just been accepted, is
            the difference between a chore and an obvious next step. */}
        {profile && !profile.verified ? (
          <ThemedText type="footnote" style={styles.body}>
            Get the verified badge and more people will answer you.
          </ThemedText>
        ) : null}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(400).delay(240)} style={styles.actions}>
        <PrimaryButton
          label="Go to chat"
          onPress={() => {
            onDismiss();
            router.push(`/chat/${match.chatId}`);
          }}
        />
        {profile && !profile.verified ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => {
              onDismiss();
              router.push('/verification');
            }}>
            <ThemedText type="callout" style={styles.later}>
              Get verified
            </ThemedText>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" hitSlop={12} onPress={onDismiss}>
          <ThemedText type="callout" style={styles.later}>
            Later
          </ThemedText>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const PHOTO = 168;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    // Fixed indigo, not a theme surface: this is a brand moment and it should
    // look identical in light and dark. Same value the splash and the intro
    // tour use, so the three brand screens cannot drift apart.
    backgroundColor: SplashField,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xl,
    paddingHorizontal: Space.xl,
    zIndex: 950,
  },
  glowWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    width: 420,
    height: 420,
    opacity: 0.75,
  },
  photoWrap: {
    width: PHOTO,
    height: PHOTO,
    borderRadius: PHOTO / 2,
    borderWidth: 4,
    borderColor: RING,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoFallback: {
    backgroundColor: BrandDeep,
  },
  text: {
    gap: Space.sm,
  },
  title: {
    color: '#FFFFFF',
    textAlign: 'center',
  },
  body: {
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: Space.md,
    alignItems: 'center',
  },
  later: {
    color: 'rgba(255,255,255,0.75)',
    paddingVertical: Space.sm,
  },
});
