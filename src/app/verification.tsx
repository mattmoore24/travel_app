import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  useLatestVerification,
  useOwnProfile,
  useSubmitVerification,
} from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';

/**
 * Selfie verification. The selfie goes into a write-only bucket and is
 * compared server-side (Claude vision) against the profile photos — a
 * plausibility check against casual catfishing, not certified identity
 * verification.
 */
export default function VerificationScreen() {
  const theme = useTheme();
  const { data: profile } = useOwnProfile();
  const { data: latest } = useLatestVerification();
  const submit = useSubmitVerification();
  const [selfieUri, setSelfieUri] = useState<string | null>(null);

  const verified = profile?.verified === true;
  const pending = !verified && latest?.status === 'pending';
  const rejected = !verified && latest?.status === 'rejected';

  const takeSelfie = async () => {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.granted) {
        const shot = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          cameraType: ImagePicker.CameraType.front,
          allowsEditing: true,
          aspect: [4, 5],
          quality: 1,
        });
        if (!shot.canceled && shot.assets.length > 0) {
          setSelfieUri(shot.assets[0].uri);
        }
        return;
      }
    }
    // Web (or camera permission denied): fall back to the photo library.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 1,
    });
    if (!picked.canceled && picked.assets.length > 0) {
      setSelfieUri(picked.assets[0].uri);
    }
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
      Alert.alert(
        'Selfie submitted',
        'We compare it with your profile photos — your badge appears once it clears review.'
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
      title="Get verified"
      subtitle="A verified badge tells other travelers your photos are really you. Take a quick selfie — it's compared with your profile photos, never shown to anyone, and deleted after review. This is a likeness check, not an identity document check."
      continueLabel={continueLabel}
      continueLoading={submit.isPending}
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
          <ThemedText type="smallBold">Selfie in review</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            We&apos;re comparing your selfie with your profile photos. This usually takes a few
            minutes.
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
          {selfieUri ? (
            <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
              <Image source={{ uri: selfieUri }} style={styles.previewImage} contentFit="cover" />
            </View>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Tips: good light, face the camera, no sunglasses — like the photos on your profile.
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
    borderRadius: Spacing.three,
  },
  preview: {
    width: '60%',
    aspectRatio: 4 / 5,
    alignSelf: 'center',
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
});
