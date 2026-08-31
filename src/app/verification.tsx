import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import {
  useLatestVerification,
  useOwnProfile,
  useSubmitVerification,
} from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { captureLivePhoto } from '@/lib/live-camera';

/**
 * Selfie verification. The selfie goes into a write-only bucket and is
 * compared server-side (Claude vision) against the profile photos — a
 * plausibility check against casual catfishing, not certified identity
 * verification.
 *
 * THE PHOTO LIBRARY IS NEVER OFFERED. This screen used to fall back to
 * `launchImageLibraryAsync` whenever the camera was refused, which read as a
 * kindness and was actually a hole: a selfie chosen out of a library proves
 * only that somebody owns a picture of a face, which is exactly what a
 * catfish has. The badge means "this face was in front of this phone a moment
 * ago" or it means nothing. Capture goes through `captureLivePhoto` and
 * nowhere else, and a source-scanning test keeps it that way.
 */
export default function VerificationScreen() {
  const theme = useTheme();
  const { data: profile } = useOwnProfile();
  const { data: latest } = useLatestVerification();
  const submit = useSubmitVerification();
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);

  const verified = profile?.verified === true;
  const pending = !verified && latest?.status === 'pending';
  const rejected = !verified && latest?.status === 'rejected';

  const takeSelfie = async () => {
    // No `aspect`: it only ever reaches Android (see live-camera.ts), so the
    // old [4, 5] claimed a 4:5 selfie while iOS captured a square.
    const shot = await captureLivePhoto({
      front: true,
      allowsEditing: true,
    });
    if (shot.kind === 'captured') {
      setCameraBlocked(false);
      haptics.medium();
      setSelfieUri(shot.uri);
      return;
    }
    if (shot.kind === 'cancelled') {
      return;
    }
    // Denied or no camera at all. Say so plainly; there is no second route.
    setCameraBlocked(true);
    haptics.error();
  };

  const onSubmit = async () => {
    if (verified || pending) {
      router.back();
      return;
    }
    if (!selfieUri) {
      await takeSelfie();
      return;
    }
    try {
      await submit.mutateAsync(selfieUri);
      haptics.success();
      // "A few minutes" matches the in-review card below; the worker runs
      // every minute (schedule_workers.sql) plus the vision check, so do not
      // promise less.
      Alert.alert(
        'Selfie sent',
        'We check it in a few minutes. Your badge appears on your profile as soon as it passes.'
      );
      router.back();
    } catch {
      // Surfaced by the global mutation error alert; stay on the screen.
    }
  };

  const continueLabel = verified
    ? 'Done'
    : pending
      ? 'Close'
      : selfieUri
        ? 'Submit selfie'
        : 'Take a selfie';

  return (
    <StepScreen
      title="Get your badge"
      subtitle="One selfie, taken right now. It proves your photos are you. Nobody sees it, and we delete it after the check. No ID needed. It also unlocks who can see you, so you can choose verified travelers only, or verified women only."
      continueLabel={continueLabel}
      continueLoading={submit.isPending}
      // Without this the first-run state's only button says "Take a selfie",
      // so the modal has no visible exit at all and the swipe down is a
      // gesture nothing on screen mentions.
      onClose={
        verified || pending ? undefined : () => (router.canGoBack() ? router.back() : undefined)
      }
      onContinue={onSubmit}>
      {verified ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            You&apos;re verified
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Your profile shows the verified badge.
          </ThemedText>
        </ThemedView>
      ) : pending ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Checking your selfie</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Usually takes a few minutes.
          </ThemedText>
        </ThemedView>
      ) : (
        <>
          {rejected && latest?.reason ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={{ color: theme.danger }}>
                Last attempt didn&apos;t pass
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {latest.reason}
              </ThemedText>
            </ThemedView>
          ) : null}

          {cameraBlocked ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={{ color: theme.warning }}>
                The camera is off for Samewhere
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Open Settings, turn Camera on, then come back. A photo out of your library
                won&apos;t do it. The badge only means something if the selfie was taken just now.
              </ThemedText>
              <PrimaryButton
                variant="ghost"
                label="Open Settings"
                accessibilityLabel="Open Settings"
                onPress={() => {
                  Linking.openSettings().catch(() => {});
                }}
              />
            </ThemedView>
          ) : null}

          {selfieUri ? (
            <View style={styles.previewBlock}>
              <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
                <Image
                  source={{ uri: selfieUri }}
                  style={styles.previewImage}
                  contentFit="cover"
                  accessibilityLabel="Your selfie"
                />
              </View>
              {/* A blurry shot could only be submitted or abandoned. Nobody
                  is going to submit a photo they can see is bad, so the real
                  behaviour was "close the screen and start again". */}
              <PrimaryButton
                variant="ghost"
                label="Retake"
                accessibilityLabel="Retake your selfie"
                disabled={submit.isPending}
                onPress={takeSelfie}
              />
            </View>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Good light, face the camera, lose the sunglasses.
          </ThemedText>
        </>
      )}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.lg,
  },
  previewBlock: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  preview: {
    width: '60%',
    aspectRatio: 4 / 5,
    alignSelf: 'center',
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
});
