import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Space } from '@/constants/theme';
import { signInWithEmail, signUpWithEmail } from '@/features/auth/api';

type Mode = 'sign-in' | 'sign-up';

export default function EmailAuthScreen() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The 8-char minimum is a signup policy; existing passwords (dashboard
  // resets, differently-configured projects) must not be blocked at sign-in.
  const canSubmit =
    email.trim().length > 3 && (mode === 'sign-in' ? password.length > 0 : password.length >= 8);

  const submit = async () => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === 'sign-in') {
        await signInWithEmail(email.trim(), password);
        // Success: the root guard swaps stacks on the auth event.
      } else {
        const { session } = await signUpWithEmail(email.trim(), password);
        if (!session) {
          setNotice('Check your inbox to confirm your email, then sign in here.');
          setMode('sign-in');
        }
      }
    } catch (e) {
      setError((e as Error).message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <StepScreen
      title={mode === 'sign-in' ? 'Welcome back' : "Let's get you set up"}
      subtitle={
        mode === 'sign-in'
          ? 'Good to see you again.'
          : 'First your login, then your profile. Two minutes, tops.'
      }
      continueLabel={mode === 'sign-in' ? 'Sign in' : 'Next: your profile'}
      continueDisabled={!canSubmit}
      continueLoading={loading}
      onContinue={submit}
      footer={
        <PrimaryButton
          variant="ghost"
          label={mode === 'sign-in' ? 'New here? Make an account' : 'Already have one? Sign in'}
          onPress={() => {
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
            setError(null);
            setNotice(null);
          }}
        />
      }>
      <FormTextField
        label="Email"
        testID="email-input"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
      />
      <FormTextField
        label="Password"
        testID="password-input"
        secureTextEntry
        autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
        textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
        value={password}
        onChangeText={setPassword}
        error={error}
        hint={mode === 'sign-up' ? 'At least 8 characters.' : undefined}
      />
      {/* Say what happens next, so nobody thinks an email and password is the
          whole signup and bails when the profile page appears. */}
      {mode === 'sign-up' ? (
        <ThemedView type="surfaceSunken" style={styles.nextCard}>
          <ThemedText type="smallBold">Next up</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            A photo, your name and age, where you are from, and anything you want people to message
            you about. All on one page, and all editable later from your profile.
          </ThemedText>
        </ThemedView>
      ) : null}
      {notice ? <ThemedText themeColor="textSecondary">{notice}</ThemedText> : null}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  nextCard: {
    padding: Space.md,
    borderRadius: Radius.md,
    gap: Space.xs,
  },
});
