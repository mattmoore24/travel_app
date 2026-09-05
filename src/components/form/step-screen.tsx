import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { KeyboardFloor } from '@/components/ui/keyboard-floor';
import { PressableScale } from '@/components/ui/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { HitTarget, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type StepScreenProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  onContinue: () => void;
  /** Quiet line above the button, e.g. what is still missing. Same slot
   * StepShell has, so a disabled Continue can always explain itself. */
  note?: string | null;
  /** The scroller itself, for a caller that needs to jump to one block. */
  scrollRef?: React.Ref<ScrollView>;
  footer?: ReactNode;
  /**
   * A visible way out.
   *
   * Most of these screens are modals, so the only exit was a swipe down —
   * which is a gesture nothing on the screen mentions, and one that ate a
   * whole bio rewrite without asking. A caller that supplies this gets a
   * real 44pt Close, and is the right place to put a "you have unsaved
   * changes" question, because only the caller knows whether there are any.
   */
  onClose?: () => void;
};

/**
 * Shared scaffold for onboarding steps and simple form screens.
 *
 * The keyboard is handled by asking the keyboard, not by KeyboardAvoidingView.
 * KAV measures its own frame against its PARENT and then compares that number
 * to a window-coordinate keyboard position, which is correct only when it is
 * the screen root sitting at the top of the window. Most of these screens are
 * presented as modals, and a modal card starts sixty-odd points down: KAV came
 * up exactly that far short, so the Send button and the last field sat under
 * the keyboard on every one of them. Same fix as the chat composer.
 */
export function StepScreen({
  title,
  subtitle,
  children,
  continueLabel = 'Continue',
  continueDisabled = false,
  continueLoading = false,
  onContinue,
  note,
  scrollRef,
  footer,
  onClose,
}: StepScreenProps) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <KeyboardFloor>
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="always"
            // "always" means a tap outside a field does NOT dismiss the
            // keyboard, which is right for moving between fields and wrong as
            // the only exit. Dragging closes it, same as the signup shell.
            keyboardDismissMode="interactive">
            <View style={styles.titleRow}>
              <ThemedText type="title" style={styles.title}>
                {title}
              </ThemedText>
              {onClose ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  haptic="light"
                  scaleTo={0.9}
                  hitSlop={6}
                  onPress={onClose}
                  style={styles.close}>
                  <SymbolView
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={16}
                    tintColor={theme.textSecondary}
                  />
                </PressableScale>
              ) : null}
            </View>
            {subtitle ? <ThemedText themeColor="textSecondary">{subtitle}</ThemedText> : null}
            {children}
          </ScrollView>
          <ThemedView style={styles.footer}>
            {note ? (
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
                {note}
              </ThemedText>
            ) : null}
            <PrimaryButton
              label={continueLabel}
              disabled={continueDisabled}
              loading={continueLoading}
              onPress={onContinue}
            />
            {footer}
          </ThemedView>
        </KeyboardFloor>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
  },
  close: {
    width: HitTarget,
    height: HitTarget,
    marginTop: -Spacing.two,
    marginRight: -Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    textAlign: 'center',
  },
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  flex: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    // Tail room so the last field clears the docked footer, which is a real
    // sibling of this scroller: without it the Age field drew as an open
    // rectangle sliced by the scroll edge under the keyboard. NOT
    // automaticallyAdjustKeyboardInsets - KeyboardFloor already pads the
    // parent by the keyboard height, and the ScrollView's own inset would
    // double-count it.
    paddingBottom: Spacing.four + HitTarget,
  },
  footer: {
    padding: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
});
