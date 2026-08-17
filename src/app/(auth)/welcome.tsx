import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { appleSignInAvailable, signInWithApple } from '@/features/auth/api';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function WelcomeScreen() {
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  useEffect(() => {
    appleSignInAvailable().then(setAppleAvailable);
  }, []);

  const handleApple = async () => {
    setAppleLoading(true);
    try {
      await signInWithApple();
    } catch (error) {
      // Cancelled sheets throw ERR_REQUEST_CANCELED — stay quiet for those.
      if ((error as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Sign in failed', 'Please try again.');
      }
    } finally {
      setAppleLoading(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.hero}>
          <SymbolView
            name={{ ios: 'map.fill', android: 'map', web: 'map' }}
            size={64}
            tintColor={theme.tint}
          />
          <ThemedText type="title" style={styles.centerText}>
            Samewhere
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Make real friends on the road. See what travelers are up to in your city — never where
            they are.
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.actions}>
          {!isSupabaseConfigured ? (
            <ThemedView type="backgroundElement" style={styles.notice}>
              <ThemedText type="small" themeColor="textSecondary">
                Backend not configured: copy .env.example to .env with your Supabase keys, then
                restart the dev server.
              </ThemedText>
            </ThemedView>
          ) : null}
          {appleAvailable ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                colorScheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={Spacing.three}
              style={styles.appleButton}
              onPress={appleLoading ? () => {} : handleApple}
            />
          ) : null}
          <PrimaryButton
            label="Continue with email"
            disabled={!isSupabaseConfigured}
            onPress={() => router.push('/email')}
          />
          {/* App Review 1.2: UGC apps must have users agree to content rules
              with zero tolerance for objectionable content. */}
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            By continuing you agree to our{' '}
            <ThemedText
              type="small"
              style={{ color: theme.tint }}
              onPress={() => router.push('/guidelines')}>
              community guidelines
            </ThemedText>
            . This is a friends app — flirting and harassment get accounts removed.
          </ThemedText>
        </ThemedView>
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
    padding: Spacing.four,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  actions: {
    gap: Spacing.three,
  },
  notice: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  appleButton: {
    alignSelf: 'stretch',
    height: 50,
  },
});
