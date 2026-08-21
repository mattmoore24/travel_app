import * as AppleAuthentication from 'expo-apple-authentication';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View, useColorScheme } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandDeep, MaxContentWidth, Spacing } from '@/constants/theme';
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
          <Animated.View entering={FadeInDown.duration(500)} style={styles.markWrap}>
            <Image
              source={require('@/assets/images/logo-glow.png')}
              style={styles.glow}
              contentFit="contain"
            />
            {/* Brand indigo, not the theme accent: the dark-scheme accent is
                a pale indigo that would wash the mark out. Icon colors don't
                theme-switch. */}
            <View style={styles.markBadge}>
              <Image
                source={require('@/assets/images/splash-icon.png')}
                style={styles.mark}
                contentFit="contain"
              />
            </View>
          </Animated.View>
          <Animated.View entering={FadeInDown.duration(500).delay(80)}>
            <ThemedText type="title" style={styles.centerText}>
              Samewhere
            </ThemedText>
          </Animated.View>
          <Animated.View entering={FadeInDown.duration(500).delay(160)}>
            <ThemedText themeColor="textSecondary" style={styles.centerText}>
              Make real friends on the road. See what people are up to in your city, never where
              they are.
            </ThemedText>
          </Animated.View>
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
            onPress={() => router.push('/join')}
          />
          {/* App Review 1.2: UGC apps must have users agree to content rules
              with zero tolerance for objectionable content. */}
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            By continuing you agree to our{' '}
            {/* The role is what makes this a child element VoiceOver can
                land on and activate. Without it the sentence reads as one
                block and the link is unreachable. */}
            <ThemedText
              type="small"
              accessibilityRole="link"
              style={{ color: theme.tint }}
              onPress={() => router.push('/guidelines')}>
              community guidelines
            </ThemedText>
            . Keep it casual and friendly.
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
  markWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 220,
    height: 220,
  },
  markBadge: {
    width: 112,
    height: 112,
    borderRadius: 28,
    backgroundColor: BrandDeep,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  mark: {
    width: 96,
    height: 96,
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
