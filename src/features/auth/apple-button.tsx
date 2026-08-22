import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, useColorScheme } from 'react-native';

import { Spacing } from '@/constants/theme';
import { appleSignInAvailable, signInWithApple } from '@/features/auth/api';
import { analytics } from '@/lib/analytics';

/**
 * Sign in with Apple, on both doors into the app.
 *
 * It renders nothing at all where Apple sign-in is not available — Android,
 * the simulator without an Apple ID, Expo Go (the entitlement only exists in
 * a real build) — so callers can drop it in unconditionally.
 *
 * There is no success branch to write: the root guard watches the auth event
 * and swaps stacks, which lands a brand new account on the profile steps and
 * a returning one in the app.
 */
export function AppleSignInButton({ label = 'signin' }: { label?: 'signin' | 'signup' }) {
  const scheme = useColorScheme();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    appleSignInAvailable().then((ok) => {
      if (alive) {
        setAvailable(ok);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!available) {
    return null;
  }

  const press = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await signInWithApple();
      analytics.capture('signup_step_completed', { step: 'apple' });
    } catch (error) {
      // A cancelled sheet is a person changing their mind, not a failure.
      if ((error as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Sign in failed', 'Please try that again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={
        label === 'signup'
          ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
          : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
      }
      // Apple's guidelines: the button takes the OPPOSITE value to the
      // surface behind it, so on this app's dark ground it is the white one.
      buttonStyle={
        scheme === 'light'
          ? AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          : AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
      }
      cornerRadius={Spacing.three}
      style={styles.button}
      onPress={press}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'stretch',
    height: 50,
  },
});
