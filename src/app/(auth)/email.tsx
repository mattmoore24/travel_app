import { useState } from 'react';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
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
          setNotice('Check your inbox — confirm your email, then sign in here.');
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
      title={mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
      subtitle={
        mode === 'sign-in'
          ? 'Sign in with your email and password.'
          : 'Email and a password of at least 8 characters.'
      }
      continueLabel={mode === 'sign-in' ? 'Sign in' : 'Create account'}
      continueDisabled={!canSubmit}
      continueLoading={loading}
      onContinue={submit}
      footer={
        <PrimaryButton
          variant="ghost"
          label={mode === 'sign-in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          onPress={() => {
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
            setError(null);
            setNotice(null);
          }}
        />
      }>
      <FormTextField
        label="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
      />
      <FormTextField
        label="Password"
        secureTextEntry
        autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
        textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
        value={password}
        onChangeText={setPassword}
        error={error}
      />
      {notice ? <ThemedText themeColor="textSecondary">{notice}</ThemedText> : null}
    </StepScreen>
  );
}
