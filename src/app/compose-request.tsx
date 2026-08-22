import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/components/form/primary-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Spacing } from '@/constants/theme';
import { useDraftWarning, useFirstMessageBudget, useSendRequest } from '@/features/matching/hooks';
import { usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

const MESSAGE_MAX = 500;

// Hinge-style: the first message is anchored to something specific on the
// recipient's profile, and it clears moderation before it can be delivered.
const ELEMENT_OPTIONS = [
  // The dates you share come first: it is the fact that put the two of you
  // in front of each other, and it is the one anchor that always exists.
  { value: 'trip', label: 'Your dates together' },
  { value: 'bio', label: 'Their bio' },
  { value: 'photo:0', label: 'A photo' },
  { value: 'languages', label: 'Languages' },
  { value: 'home', label: 'Where they are from' },
] as const;

export default function ComposeRequestScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    userId: string;
    name: string;
    photoPath: string;
    source?: string;
    element?: string;
    /** What the profile said this element was, for the card below. */
    targetLabel?: string;
    targetPhoto?: string;
    targetQuote?: string;
    /** Opening line supplied by the surface that sent you here (e.g. a pin). */
    draft?: string;
  }>();
  const { data: photoUrl } = usePhotoUrl(params.photoPath || null);
  const { data: targetPhotoUrl } = usePhotoUrl(params.targetPhoto || null);
  const sendRequest = useSendRequest();

  const source = params.source === 'pin' ? ('pin' as const) : ('trip_match' as const);
  const [element, setElement] = useState<string>(params.element ?? 'bio');
  const [message, setMessage] = useState(params.draft ?? '');
  const [blockedNotice, setBlockedNotice] = useState(false);
  const [capped, setCapped] = useState<number | null>(null);
  const budget = useFirstMessageBudget();
  // Asked while the sentence is still being written, so a message that would
  // be stopped becomes a reword rather than a rejection. Advisory only: the
  // send path runs the same check server-side either way.
  const risky = useDraftWarning(message, !blockedNotice);
  // The composer's own confirmation. Sending used to dismiss the screen with
  // no acknowledgement at all: the same nothing you get from a failed tap.
  const [sent, setSent] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Arriving from a reply bubble on the profile, the thing being answered is
  // already decided and shown. The old chip row stays as the fallback for
  // anyone who got here from the Say hi button instead.
  const [pickingElement, setPickingElement] = useState(!params.targetLabel);

  const submit = async () => {
    if (!params.userId || message.trim().length === 0) {
      return;
    }
    setBlockedNotice(false);
    try {
      const result = await sendRequest.mutateAsync({
        recipientId: params.userId,
        source,
        firstMessage: message.trim(),
        profileElement: element,
      });
      if (result.capped) {
        haptics.error();
        setCapped(result.allowed ?? 8);
        return;
      }
      if (result.blocked) {
        haptics.error();
        setBlockedNotice(true);
        // The notice renders at the bottom of a form that is usually taller
        // than the screen, so without this the app answers a refusal by
        // appearing to do nothing.
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
        return;
      }
      haptics.success();
      setSent(true);
      // Long enough to read, short enough not to be a wall. Travelers has
      // already moved on to the next person underneath.
      setTimeout(() => router.back(), CONFIRM_MS);
    } catch {
      // Surfaced by the global mutation error alert; stay on the composer.
    }
  };

  // The cap gets its own screen rather than a red line under the box. It is
  // not a rejection of what was written — the words are fine, there are just
  // no more hellos today — so it reads as a full stop, not a correction.
  if (capped != null) {
    return (
      <ThemedView style={styles.sentRoot}>
        <View style={[styles.sentMark, { backgroundColor: theme.surfaceSunken }]}>
          <SymbolView
            name={{ ios: 'moon.zzz.fill', android: 'bedtime', web: 'bedtime' }}
            size={30}
            tintColor={theme.textSecondary}
          />
        </View>
        <View style={styles.sentText}>
          <ThemedText type="subtitle" style={styles.centred}>
            That is your {capped} for today
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centred}>
            They will hear from you first thing tomorrow. A few good hellos beat a lot of
            forgettable ones, and the people on the other end will tell you the same.
          </ThemedText>
        </View>
        <PrimaryButton label="Fair enough" onPress={() => router.back()} />
      </ThemedView>
    );
  }

  if (sent) {
    return (
      <ThemedView style={styles.sentRoot}>
        <Animated.View
          entering={ZoomIn.springify().duration(550).dampingRatio(0.75)}
          style={[styles.sentMark, { backgroundColor: theme.accentSoft }]}>
          <SymbolView
            name={{ ios: 'paperplane.fill', android: 'send', web: 'send' }}
            size={30}
            tintColor={theme.accent}
          />
        </Animated.View>
        <Animated.View entering={FadeIn.delay(120).duration(240)} style={styles.sentText}>
          <ThemedText type="subtitle" style={styles.centred}>
            Sent to {params.name ?? 'them'}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centred}>
            You will hear from them in Chat if they answer.
          </ThemedText>
        </Animated.View>
      </ThemedView>
    );
  }

  return (
    <StepScreen
      scrollRef={scrollRef}
      title={`Say hi to ${params.name ?? 'this traveler'}`}
      subtitle="They see this and your profile. If they reply, your chat opens."
      continueLabel="Send"
      continueDisabled={message.trim().length === 0 || message.length > MESSAGE_MAX}
      continueLoading={sendRequest.isPending}
      onContinue={submit}>
      <View style={styles.recipientRow}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.avatarImage} contentFit="cover" />
          ) : null}
        </View>
        <ThemedText type="smallBold">{params.name ?? 'Traveler'}</ThemedText>
      </View>

      {source === 'pin' ? (
        <ThemedText type="small" themeColor="textSecondary">
          About their pin{params.element ? `: ${params.element.replace(/^pin:/, '')}` : ''}
        </ThemedText>
      ) : pickingElement ? (
        <>
          <ThemedText type="smallBold">What are you replying to?</ThemedText>
          <ChipRow
            options={ELEMENT_OPTIONS}
            selected={[element]}
            onToggle={(value) => setElement(value)}
          />
        </>
      ) : (
        <ThemedView type="backgroundElement" style={styles.targetCard}>
          {targetPhotoUrl ? (
            <Image source={{ uri: targetPhotoUrl }} style={styles.targetPhoto} contentFit="cover" />
          ) : null}
          <View style={styles.targetText}>
            <ThemedText type="caption" themeColor="textSecondary">
              Replying to {params.targetLabel ?? ''}
            </ThemedText>
            {params.targetQuote ? (
              <ThemedText type="small" numberOfLines={3}>
                {params.targetQuote}
              </ThemedText>
            ) : null}
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Reply to something else"
            haptic="light"
            scaleTo={0.94}
            onPress={() => setPickingElement(true)}>
            <ThemedText type="footnote" themeColor="accent">
              Change
            </ThemedText>
          </PressableScale>
        </ThemedView>
      )}

      <FormTextField
        label="Your first message"
        multiline
        numberOfLines={4}
        style={styles.messageInput}
        placeholder="Say something they can actually reply to."
        value={message}
        onChangeText={setMessage}
      />
      <View style={styles.countRow}>
        <ThemedText type="small" themeColor="textSecondary">
          {message.length}/{MESSAGE_MAX}
        </ThemedText>
        {/* Shown only near the limit. Every hello is capped, but a person on
            their second of eight does not need to be told about it. */}
        {budget.data && budget.data.allowed - budget.data.used <= 3 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {Math.max(budget.data.allowed - budget.data.used, 0)} hellos left today
          </ThemedText>
        ) : null}
      </View>

      {risky && !blockedNotice ? (
        <ThemedView type="backgroundElement" style={styles.blockedCard}>
          <ThemedText type="smallBold" style={{ color: theme.highlight }}>
            This might land wrong
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Samewhere is for making friends, not for coming on to people. Reword it and it will go
            straight through.
          </ThemedText>
        </ThemedView>
      ) : null}

      {blockedNotice ? (
        <ThemedView type="backgroundElement" style={styles.blockedCard}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            That message can&apos;t be sent
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            That came across as explicit. Reword it and send again.
          </ThemedText>
        </ThemedView>
      ) : null}
    </StepScreen>
  );
}

/** How long the confirmation holds before the composer dismisses itself. */
const CONFIRM_MS = 1100;

const styles = StyleSheet.create({
  sentRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
  },
  sentMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentText: {
    gap: Spacing.two,
  },
  centred: {
    textAlign: 'center',
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  targetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
  },
  targetPhoto: {
    width: 52,
    height: 52,
    borderRadius: 10,
  },
  targetText: {
    flex: 1,
    gap: 2,
  },
  messageInput: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  blockedCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.lg,
  },
});
