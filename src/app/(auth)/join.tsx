import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { signUpWithEmail } from '@/features/auth/api';
import { StepShell } from '@/features/signup/step-shell';
import { SIGNUP_TOTAL_STEPS } from '@/features/signup/steps';
import { haptics } from '@/lib/haptics';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

/**
 * The first two steps of making an account: one question per screen, same
 * chrome as the four profile steps that follow, so the whole thing reads as
 * one six-step sequence even though the account gets created in the middle
 * of it (that is what swaps the app from the auth stack to onboarding).
 */
export default function JoinScreen() {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [loading, setLoading] = useState(false);

  const emailOk = EMAIL_PATTERN.test(email.trim());
  const passwordOk = password.length >= PASSWORD_MIN;
  const matches = confirm.length > 0 && confirm === password;

  const submitEmail = () => {
    setTouched(true);
    if (!emailOk) {
      return;
    }
    haptics.light();
    setTouched(false);
    setStep(2);
  };

  const submitPassword = async () => {
    setTouched(true);
    if (!passwordOk || !matches) {
      return;
    }
    setError(null);
    setTaken(false);
    setLoading(true);
    try {
      await signUpWithEmail(email.trim(), password);
      haptics.success();
      // The root guard swaps to the profile steps on the auth event.
    } catch (e) {
      const message = (e as Error).message ?? 'Something went wrong.';
      if (/already|registered|exists/i.test(message)) {
        setTaken(true);
        setError('That email already has an account.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (step === 1) {
    return (
      <StepShell
        step={1}
        total={SIGNUP_TOTAL_STEPS}
        title="What is your email?"
        subtitle="Used to sign in and nothing else. No newsletters."
        continueLabel="Continue"
        continueDisabled={!emailOk}
        onContinue={submitEmail}
        onBack={router.canGoBack() ? () => router.back() : undefined}
        footer={
          <PrimaryButton
            variant="ghost"
            label="I already have an account"
            onPress={() => router.push('/email')}
          />
        }>
        <FormTextField
          label="Email"
          testID="email-input"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setTouched(false);
          }}
          onSubmitEditing={submitEmail}
          error={touched && !emailOk ? 'Check that address and try again.' : null}
        />
      </StepShell>
    );
  }

  return (
    <StepShell
      step={2}
      total={SIGNUP_TOTAL_STEPS}
      title="Pick a password"
      subtitle="Twice, so a typo cannot lock you out later."
      continueLabel="Create account"
      continueTestID="create-account"
      continueDisabled={!passwordOk || !matches}
      continueLoading={loading}
      onContinue={submitPassword}
      onBack={() => {
        setTouched(false);
        setError(null);
        setStep(1);
      }}
      footer={
        taken ? (
          <PrimaryButton
            variant="ghost"
            label="Sign in instead"
            onPress={() => router.push('/email')}
          />
        ) : null
      }>
      <FormTextField
        label="Password"
        testID="password-input"
        autoFocus
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setError(null);
        }}
        hint={`At least ${PASSWORD_MIN} characters.`}
        error={touched && !passwordOk ? `At least ${PASSWORD_MIN} characters.` : null}
      />
      <FormTextField
        label="Password again"
        testID="password-confirm-input"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={confirm}
        onChangeText={(text) => {
          setConfirm(text);
          setError(null);
        }}
        onSubmitEditing={submitPassword}
        error={
          error ?? (touched && confirm.length > 0 && !matches ? 'These do not match yet.' : null)
        }
      />
      {matches ? (
        <View style={styles.matchRow}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Passwords match. Your profile is next.
          </ThemedText>
        </View>
      ) : null}
    </StepShell>
  );
}

const styles = StyleSheet.create({
  matchRow: {
    paddingTop: Space.xs,
  },
});
