import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Space } from '@/constants/theme';
import {
  useLatestStorefrontCheck,
  useOwnBusiness,
  useSubmitStorefront,
} from '@/features/business/hooks';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';

/**
 * The check beside a place's name, earned by standing in front of it.
 *
 * Two shots and not one, because a close-up of a sign is the easiest thing on
 * earth to find on the internet, while a wide shot ties that sign to a
 * building, a street and a city that all have to agree with each other and
 * with the marker the place dropped on the map (docs/BUSINESS_ACCOUNTS.md
 * §3.9).
 *
 * THE PHOTO LIBRARY IS NEVER OFFERED, and that is the deliberate difference
 * from `verification.tsx`, which falls back to `launchImageLibraryAsync` when
 * the camera is refused. A picker turns this whole check into a
 * search-and-download, which is the single thing it exists to stop. Refused
 * camera permission gets an explanation and a way to fix it, never a second
 * route.
 */

const SHOTS = [
  {
    key: 'wide',
    heading: 'The wide shot',
    direction: 'Stand back across the street and get the whole front in, with your sign.',
  },
  {
    key: 'close',
    heading: 'The close shot',
    direction: 'Now get closer, so we can read the sign.',
  },
] as const;

type ShotKey = (typeof SHOTS)[number]['key'];

export default function BusinessStorefrontScreen() {
  const theme = useTheme();
  const { data: business } = useOwnBusiness();
  const businessId = business?.id ?? null;
  const check = useLatestStorefrontCheck(businessId);
  const submit = useSubmitStorefront(businessId);
  const [wideUri, setWideUri] = useState<string | null>(null);
  const [closeUri, setCloseUri] = useState<string | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);

  const latest = check.data ?? null;
  // The check query keeps the PREVIOUS row while it refetches, so between a
  // successful send and the refetch landing, the newest row we hold is the old
  // one (or none at all) and the screen would flash the empty form back at
  // somebody who has just sent. Both timestamps come from this device's clock,
  // so the comparison carries no server skew: trust our own send until the
  // query has fetched something after it.
  const awaitingRefetch = submit.isSuccess && check.dataUpdatedAt < submit.submittedAt;

  const approved = business?.verified === true || latest?.status === 'approved';
  const pending = !approved && (awaitingRefetch || latest?.status === 'pending');
  const uncertain = !approved && !pending && latest?.status === 'uncertain';
  const rejected = !approved && !pending && latest?.status === 'rejected';
  const settled = approved || pending || uncertain;

  const capture = async (which: ShotKey) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setCameraBlocked(true);
      haptics.error();
      return;
    }
    setCameraBlocked(false);
    // No allowsEditing. A crop tool is a way to cut the street out of the wide
    // shot, and the street is the half that cannot be downloaded.
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (shot.canceled || shot.assets.length === 0) {
      return;
    }
    haptics.medium();
    if (which === 'wide') {
      setWideUri(shot.assets[0].uri);
    } else {
      setCloseUri(shot.assets[0].uri);
    }
  };

  const onContinue = async () => {
    if (settled) {
      router.back();
      return;
    }
    if (wideUri == null) {
      await capture('wide');
      return;
    }
    if (closeUri == null) {
      await capture('close');
      return;
    }
    try {
      await submit.mutateAsync({ wideUri, closeUri });
      analytics.capture('business_storefront_submitted');
      haptics.success();
      // Stay put. The screen redraws as "we're having a look", which is the
      // thing the button promised; walking somebody back to where they came
      // from would leave them wondering whether it went at all.
      setWideUri(null);
      setCloseUri(null);
    } catch {
      // Surfaced by the global mutation error alert. The shots stay staged, so
      // a failed upload is retried from here rather than from the pavement.
    }
  };

  const continueLabel = approved
    ? 'Done'
    : pending || uncertain
      ? 'Close'
      : wideUri == null
        ? 'Take the wide shot'
        : closeUri == null
          ? 'Take the close shot'
          : 'Send them in';

  return (
    <StepScreen
      title="Show us the front"
      subtitle="Two photos, taken right now, one after the other. That is what puts the check beside your name."
      continueLabel={continueLabel}
      continueDisabled={business == null && !settled}
      continueLoading={submit.isPending}
      note={
        business == null && !settled
          ? 'Getting your place.'
          : !settled && wideUri != null && closeUri == null
            ? 'Take the close one now, while you are still standing there.'
            : null
      }
      // Only while the primary button is not itself a way out: two controls
      // both labelled Close is exactly the ambiguity VoiceOver cannot resolve.
      onClose={!settled && router.canGoBack() ? () => router.back() : undefined}
      onContinue={onContinue}>
      {approved ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.cardHead}>
            <SymbolView
              name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
              size={18}
              tintColor={theme.accent}
            />
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              You&apos;re verified
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            The check sits beside your name on your page.
          </ThemedText>
        </ThemedView>
      ) : pending ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">We&apos;re having a look</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            This usually takes a minute.
          </ThemedText>
        </ThemedView>
      ) : uncertain ? (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Someone is looking at these by hand</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            The photos were hard to call, so a person is checking them. We&apos;ll email you either
            way.
          </ThemedText>
        </ThemedView>
      ) : (
        <>
          {rejected && latest?.reason ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={{ color: theme.warning }}>
                That one didn&apos;t pass
              </ThemedText>
              {/* Verbatim. The reason is written to be read by a person, and
                  paraphrasing it here would cost the one sentence that says
                  what to do differently. */}
              <ThemedText type="small" themeColor="textSecondary">
                {latest.reason}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Have another go. Same two shots.
              </ThemedText>
            </ThemedView>
          ) : null}

          {cameraBlocked ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={{ color: theme.warning }}>
                The camera is off for Samewhere
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Open Settings, turn Camera on, then come back and take the two shots. An old photo
                out of your library won&apos;t do it. Standing there is the whole check.
              </ThemedText>
              <PrimaryButton
                variant="ghost"
                label="Open Settings"
                accessibilityLabel="Open Settings"
                onPress={() => {
                  // Leaves the app rather than pushing a route underneath a
                  // presented screen, so it needs none of the sheet dance.
                  Linking.openSettings().catch(() => {});
                }}
              />
            </ThemedView>
          ) : null}

          {SHOTS.map((shot) => {
            const uri = shot.key === 'wide' ? wideUri : closeUri;
            return (
              <View key={shot.key} style={styles.shot}>
                <ThemedText type="smallBold">{shot.heading}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {shot.direction}
                </ThemedText>
                {uri ? (
                  <>
                    <View style={[styles.frame, { backgroundColor: theme.surfaceSunken }]}>
                      <Image
                        source={{ uri }}
                        style={styles.image}
                        contentFit="cover"
                        accessibilityLabel={shot.heading}
                      />
                    </View>
                    <PrimaryButton
                      variant="ghost"
                      label="Retake"
                      accessibilityLabel={`Retake ${shot.heading.toLowerCase()}`}
                      disabled={submit.isPending}
                      onPress={() => capture(shot.key)}
                    />
                  </>
                ) : (
                  <View
                    style={[
                      styles.frame,
                      styles.empty,
                      { backgroundColor: theme.surfaceSunken, borderColor: theme.hairline },
                    ]}>
                    <SymbolView
                      name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                      size={22}
                      tintColor={theme.textTertiary}
                    />
                  </View>
                )}
              </View>
            );
          })}

          <ThemedText type="footnote" themeColor="textSecondary">
            Camera only, and both in one go. If they end up more than fifteen minutes apart
            we&apos;ll ask for the pair again.
          </ThemedText>
        </>
      )}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.xs,
    padding: Space.lg,
    borderRadius: Radius.lg,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  shot: {
    gap: Space.sm,
  },
  frame: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
