import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

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
};

/** Shared scaffold for onboarding steps and simple form screens. */
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
}: StepScreenProps) {
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="always"
            // "always" means a tap outside a field does NOT dismiss the
            // keyboard, which is right for moving between fields and wrong as
            // the only exit. Dragging closes it, same as the signup shell.
            keyboardDismissMode="interactive">
            <ThemedText type="subtitle">{title}</ThemedText>
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
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
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
  },
  footer: {
    padding: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
});
