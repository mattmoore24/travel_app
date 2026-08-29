import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInRight,
  FadeOutLeft,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect } from 'react';

import { KeyboardDoneBar } from '@/components/form/keyboard-done-bar';
import { PrimaryButton } from '@/components/form/primary-button';
import { KeyboardFloor } from '@/components/ui/keyboard-floor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, MaxContentWidth, Radius, Space, Springs } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type StepShellProps = {
  /** 1-based, and continuous across the account and profile halves. */
  step: number;
  total: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  /** Quiet line above the button, e.g. what is still missing. */
  note?: string | null;
  footer?: ReactNode;
  continueTestID?: string;
  /**
   * A step somebody may pass over. Renders a quiet "Skip for now" under the
   * button, which is the founder's rule: only non-essential steps get one, so
   * its absence is what says a step is required.
   */
  onSkip?: () => void;
  skipLabel?: string;
};

/**
 * One step of the signup sequence. Every step shares this chrome so the
 * six screens read as one moving thing rather than six forms: the progress
 * bar springs forward, the content slides in from the right as the previous
 * step leaves to the left, and the button never moves.
 */
export function StepShell({
  step,
  total,
  title,
  subtitle,
  children,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled = false,
  continueLoading = false,
  note,
  footer,
  continueTestID,
  onSkip,
  skipLabel = 'Skip for now',
}: StepShellProps) {
  const theme = useTheme();
  const progress = useSharedValue(step / total);

  useEffect(() => {
    progress.value = withSpring(step / total, Springs.gentle);
  }, [progress, step, total]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.min(100, Math.max(0, progress.value * 100))}%`,
  }));

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.backSlot}>
            {onBack ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Back"
                haptic="light"
                scaleTo={0.9}
                onPress={onBack}
                style={styles.back}>
                <SymbolView
                  name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
                  size={18}
                  tintColor={theme.text}
                />
              </PressableScale>
            ) : null}
          </View>
          <View style={[styles.track, { backgroundColor: theme.surfaceSunken }]}>
            <Animated.View style={[styles.fill, { backgroundColor: theme.accent }, fillStyle]} />
          </View>
          <View style={styles.backSlot} />
        </View>

        {/* KeyboardFloor, not KeyboardAvoidingView. The avoider measures its
            own frame against its PARENT, which is right for the four
            full-screen signup steps and wrong for `business-signup`, the one
            consumer presented as a modal: the card is inset from the window,
            so the avoider under-shoots by the inset and the autofocused
            field on steps 1 and 3 sits under the keyboard. Same swap
            step-screen.tsx already made, for the same reason. */}
        <KeyboardFloor>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="interactive">
            {/* Keyed on the step so each one animates in as its own scene. */}
            <Animated.View
              key={step}
              entering={FadeInRight.duration(320)}
              exiting={FadeOutLeft.duration(200)}
              style={styles.scene}>
              <ThemedText type="title">{title}</ThemedText>
              {subtitle ? <ThemedText themeColor="textSecondary">{subtitle}</ThemedText> : null}
              <View style={styles.fields}>{children}</View>
            </Animated.View>
          </ScrollView>

          <ThemedView style={styles.footer}>
            {note ? (
              <Animated.View entering={FadeIn.duration(160)}>
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
                  {note}
                </ThemedText>
              </Animated.View>
            ) : null}
            <PrimaryButton
              testID={continueTestID}
              label={continueLabel}
              disabled={continueDisabled}
              loading={continueLoading}
              onPress={onContinue}
            />
            {/* Small, quiet, and only where it belongs. A step with no skip
                has no skip button, which is how somebody can tell at a glance
                which questions the app actually needs answered. */}
            {onSkip ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={skipLabel}
                haptic="light"
                scaleTo={0.98}
                onPress={onSkip}
                style={styles.skip}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {skipLabel}
                </ThemedText>
              </PressableScale>
            ) : null}
            {footer}
          </ThemedView>
        </KeyboardFloor>
        {/* Outside the scroller and outside the avoider: iOS hosts this in
            the keyboard's own window, so where it sits in the tree only
            decides which fields can reach it by id. */}
        <KeyboardDoneBar />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    alignSelf: 'stretch',
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
  backSlot: {
    width: HitTarget,
    height: HitTarget,
    justifyContent: 'center',
  },
  back: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  content: {
    padding: Space.lg,
    paddingTop: Space.sm,
    paddingBottom: Space.xxl,
  },
  scene: {
    gap: Space.sm,
  },
  fields: {
    gap: Space.lg,
    marginTop: Space.lg,
  },
  footer: {
    padding: Space.lg,
    paddingTop: Space.sm,
    gap: Space.sm,
  },
  skip: {
    minHeight: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    textAlign: 'center',
  },
});
