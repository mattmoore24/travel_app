import { router } from 'expo-router';
import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { signInWithEmail } from '@/features/auth/api';

/**
 * Sign in, and only sign in. Making an account is its own sequence at
 * /join — the two used to share this screen behind a toggle that always
 * opened on sign-in, so every "make my profile" button in the app landed
 * new users on a form asking for a password they had never set.
 */
export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Return moves you along. Tapping the next field while the keyboard is up
  // does not reliably move focus on iOS — that is how a sign-in attempt came
  // back with the password box still empty.
  const passwordField = useRef<TextInput>(null);

  const canSubmit = email.trim().length > 3 && password.length > 0;

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithEmail(email.trim(), password);
      // Success: the root guard swaps stacks on the auth event.
    } catch (e) {
      setError((e as Error).message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <StepScreen
      title="Welcome back"
      subtitle="Good to see you again."
      continueLabel="Sign in"
      continueDisabled={!canSubmit}
      continueLoading={loading}
      onContinue={submit}
      footer={
        <PrimaryButton
          variant="ghost"
          label="New here? Make an account"
          onPress={() => router.replace('/join')}
        />
      }>
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
      <ThemedText type="footnote" themeColor="textSecondary">
        Forgot it? Make a new account for now — password recovery lands shortly.
      </ThemedText>
    </StepScreen>
  );
}
