import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { isOffline } from '@/lib/failure-message';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { requestPasswordReset, signInWithEmail } from '@/features/auth/api';
import { AppleSignInButton } from '@/features/auth/apple-button';
import { ConsentNote } from '@/features/auth/consent-note';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

/**
 * Sign in, and only sign in. Making an account is its own sequence at
 * /join — the two used to share this screen behind a toggle that always
 * opened on sign-in, so every "make my profile" button in the app landed
 * new users on a form asking for a password they had never set.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Return moves you along. Tapping the next field while the keyboard is up
  // does not reliably move focus on iOS — that is how a sign-in attempt came
  // back with the password box still empty.
  const passwordField = useRef<TextInput>(null);

  const canSubmit = email.trim().length > 3 && password.length > 0;
  const canReset = email.trim().length > 3;

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithEmail(email.trim(), password);
      // Success: the root guard swaps stacks on the auth event.
    } catch (e) {
      // Supabase says "Invalid login credentials" for a wrong password AND
      // for an address that has no account, and it said it in red under the
      // password box — pointing at the field that may well be fine, in API
      // English. One sentence, naming both possibilities, and the way out.
      const raw = (e as { message?: unknown })?.message;
      const text = typeof raw === 'string' ? raw : '';
      setError(
        /invalid login credentials|invalid_credentials/i.test(text)
          ? 'That email and password do not match. Check the address, or reset your password.'
          : isOffline(e)
            ? 'No connection. Signing in needs the internet.'
            : 'Could not sign you in. Try that again in a moment.'
      );
    } finally {
      setLoading(false);
    }
  };

  const sendReset = async () => {
    if (!canReset || resetting) {
      return;
    }
    setResetting(true);
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // Deliberately silent, and deliberately optimistic below. Telling
      // somebody "no account with that address" is an account-existence
      // oracle: anybody could type addresses in and learn who is on here.
    } finally {
      setResetting(false);
      haptics.success();
      setResetSent(true);
    }
  };

  // The confirmation is its own screen state rather than an alert, because a
  // person now has to leave the app, find a mail client and come back — and
  // an alert they dismissed on the way out tells them nothing when they do.
  if (resetSent) {
    return (
      <StepScreen
        title="Check your email"
        subtitle={`If ${email.trim()} has an account, a reset link is on its way. It expires in an hour.`}
        continueLabel="Back to sign in"
        onContinue={() => setResetSent(false)}
        footer={
          <PrimaryButton
            variant="ghost"
            label="Send it again"
            loading={resetting}
            onPress={sendReset}
          />
        }>
        <ThemedText type="footnote" themeColor="textSecondary">
          Nothing yet? Check your spam, and check the address above.
        </ThemedText>
      </StepScreen>
    );
  }

  return (
    <StepScreen
      title="Welcome back"
      subtitle="Good to see you again."
      continueLabel="Sign in"
      continueDisabled={!canSubmit}
      continueLoading={loading}
      onContinue={submit}
      footer={
        <View style={styles.footer}>
          <ConsentNote />
          <PrimaryButton
            variant="ghost"
            label="New here? Make an account"
            onPress={() => router.replace('/join')}
          />
        </View>
      }>
      <View style={styles.appleRow}>
        <AppleSignInButton label="signin" />
      </View>
      <FormTextField
        label="Email"
        testID="email-input"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordField.current?.focus()}
        value={email}
        onChangeText={setEmail}
      />
      <FormTextField
        label="Password"
        testID="password-input"
        inputRef={passwordField}
        secureTextEntry
        revealToggle
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => {
          if (canSubmit) {
            submit();
          }
        }}
        value={password}
        onChangeText={setPassword}
        error={error}
      />
      {/* A real way back in. This used to read "make a new account for now",
          which is advice that cannot work: the address already has one. */}
      <ThemedText
        type="footnote"
        accessibilityRole="link"
        accessibilityHint={
          canReset ? undefined : 'Enter your email address first, then tap this again'
        }
        style={[styles.forgot, { color: canReset ? theme.tint : theme.textSecondary }]}
        onPress={sendReset}>
        {canReset ? 'Forgot your password?' : 'Forgot your password? Enter your email first.'}
      </ThemedText>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  appleRow: {
    paddingBottom: Space.sm,
  },
  forgot: {
    paddingTop: Space.xs,
  },
  footer: {
    gap: Space.md,
  },
});
