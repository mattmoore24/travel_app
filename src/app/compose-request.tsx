import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/components/form/primary-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Spacing } from '@/constants/theme';
import { countOf } from '@/lib/plural';
import { useDraftWarning, useFirstMessageBudget, useSendRequest } from '@/features/matching/hooks';
import { usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

const MESSAGE_MAX = 500;

/**
 * Codepoints, the way the DB's `char_length` check counts (an emoji is 1
 * here and 2 in `.length`), so the counter and the cap agree with the row
 * constraint on message_requests.
 */
const messageLength = (value: string) => [...value].length;

// Hinge-style: the first message is anchored to something specific on the
// recipient's profile, and it clears moderation before it can be delivered.
// Exported for the anchors test's completeness guard: every value here must
// parse to its own anchor kind, never fall through to 'bio'.
export const ELEMENT_OPTIONS = [
  // The dates you share come first: it is the fact that put the two of you
  // in front of each other, and it is the one anchor that always exists.
  { value: 'trip', label: 'Your dates together' },
  { value: 'bio', label: 'Their bio' },
  // A plan is the easiest thing on a profile to answer, so it sits high.
  { value: 'priority', label: 'Something on their list' },
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
  // 'trip', not 'bio': the dates you share are the one anchor that always
  // exists (see ELEMENT_OPTIONS above), while defaulting to a bio claimed a
  // hello came from a field the recipient may never have filled in.
  const [element, setElement] = useState<string>(params.element ?? 'trip');
  const [message, setMessage] = useState(params.draft ?? '');
  const [blockedNotice, setBlockedNotice] = useState(false);
  // The exact text the server refused. The quiet finish-line card below may
  // only appear once the draft actually DIFFERS from this: `risky` needs 12+
  // characters and a debounced preview, so on its own it goes false for an
  // emptied box, a one-character edit, and anything the preview never saw,
  // and the card would bless the refused message itself.
  const [refusedText, setRefusedText] = useState<string | null>(null);
  // Whether anything was ever typed here. The at-the-door cap card may only
  // replace the composer BEFORE writing starts: after "Keep my message", the
  // budget refetch says capped, and clearing the box to reword would
  // otherwise swap the whole screen out from under the person mid-edit.
  const [wrote, setWrote] = useState(false);
  const [capped, setCapped] = useState<number | null>(null);
  const budget = useFirstMessageBudget();
  // Asked while the sentence is still being written, so a message that would
  // be stopped becomes a reword rather than a rejection. Advisory only: the
  // send path runs the same check server-side either way. Always on — it
  // used to switch off the moment a send was refused, which left the person
  // rewriting a blocked message typing with no guidance and manufacturing
  // the second strike by pressing Send to find out. The preview RPC is
  // read-only and swallows its own errors, so leaving it on costs nothing.
  const risky = useDraftWarning(message, true);
  // The composer's own confirmation. Sending used to dismiss the screen with
  // no acknowledgement at all: the same nothing you get from a failed tap.
  const [sent, setSent] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // The pop-after-confirmation timer, so leaving early cancels it.
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (backTimer.current) {
        clearTimeout(backTimer.current);
      }
    },
    []
  );
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
        // The overlay is a sibling in this tree, so nothing unmounts the
        // focused input for us: without this the keyboard stays up, covers
        // the overlay's buttons, and keystrokes keep editing the invisible
        // draft underneath.
        Keyboard.dismiss();
        setCapped(result.allowed ?? 8);
        return;
      }
      if (result.blocked) {
        haptics.error();
        setRefusedText(message.trim());
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
      //
      // Held so it can be cancelled. Swiping this modal down inside the
      // window used to leave the timer running, and it then popped the
      // screen UNDERNEATH — somebody who dismissed the confirmation early
      // was thrown off the profile they were reading back to the tabs.
      backTimer.current = setTimeout(() => router.back(), CONFIRM_MS);
    } catch {
      // Surfaced by the global mutation error alert; stay on the composer.
    }
  };

  // The cap reads as a full stop, not a correction: it is not a rejection of
  // what was written, there are just no more hellos today. Two ways in:
  //
  // At the door — the budget was already spent before this screen opened, so
  // say so before anybody writes into a box that cannot send. Gated on the
  // query having LOADED (never a flash over an undefined answer) and on the
  // box being empty, so a draft that survived the mid-session overlay below
  // is never destroyed by this branch on the next render.
  if (
    capped == null &&
    budget.data != null &&
    budget.data.used >= budget.data.allowed &&
    message.trim().length === 0 &&
    !wrote
  ) {
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
            That is your {budget.data.allowed} for today
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centred}>
            More tomorrow. A few good ones beat a pile of forgettable ones.
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
            You&apos;ll hear back in Chat if they answer.
          </ThemedText>
        </Animated.View>
      </ThemedView>
    );
  }

  return (
    <View style={styles.composerRoot}>
      <StepScreen
        scrollRef={scrollRef}
        title={`Say hi to ${params.name ?? 'this traveler'}`}
        subtitle="They see this and your profile. If they reply, your chat opens."
        continueLabel="Send"
        continueDisabled={message.trim().length === 0 || messageLength(message) > MESSAGE_MAX}
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
            <ThemedText type="smallBold">What are you saying hi about?</ThemedText>
            <ChipRow
              options={ELEMENT_OPTIONS}
              selected={[element]}
              onToggle={(value) => setElement(value)}
            />
          </>
        ) : (
          <ThemedView type="backgroundElement" style={styles.targetCard}>
            {targetPhotoUrl ? (
              <Image
                source={{ uri: targetPhotoUrl }}
                style={styles.targetPhoto}
                contentFit="cover"
              />
            ) : null}
            <View style={styles.targetText}>
              <ThemedText type="caption" themeColor="textSecondary">
                Saying hi about {params.targetLabel ?? ''}
              </ThemedText>
              {params.targetQuote ? (
                <ThemedText type="small" numberOfLines={3}>
                  {params.targetQuote}
                </ThemedText>
              ) : null}
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Say hi about something else"
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
          onChangeText={(text) => {
            setWrote(true);
            setMessage(text);
          }}
          {...keyboardDoneProps}
        />
        <View style={styles.countRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {messageLength(message)}/{MESSAGE_MAX}
          </ThemedText>
          {/* Shown only near the limit. Every hello is capped, but a person on
            their second of eight does not need to be told about it. */}
          {budget.data && budget.data.allowed - budget.data.used <= 3 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {countOf(Math.max(budget.data.allowed - budget.data.used, 0), 'first message')} left
              today
            </ThemedText>
          ) : null}
        </View>

        {/* Three branches of one advisory, driven by `risky` (the live
          preview) and `blockedNotice` (a send was refused). A rewrite after
          a refusal keeps the red card while the draft still reads blocked,
          and gets a visible finish line once it does not — without ever
          promising delivery, because the preview only runs the regex
          prefilter and cannot predict the LLM verdict. */}
        {risky && !blockedNotice ? (
          <ThemedView type="backgroundElement" style={styles.blockedCard}>
            <ThemedText type="smallBold" style={{ color: theme.highlight }}>
              This might not go through
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Explicit messages are not delivered. Reword it and it goes straight out.
            </ThemedText>
          </ThemedView>
        ) : null}

        {blockedNotice && (risky || message.trim() === refusedText) ? (
          <ThemedView type="backgroundElement" style={styles.blockedCard}>
            <ThemedText type="smallBold" style={{ color: theme.danger }}>
              That message can&apos;t be sent
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              That came across as explicit. Reword it and send again.
            </ThemedText>
          </ThemedView>
        ) : null}

        {blockedNotice && !risky && message.trim().length > 0 && message.trim() !== refusedText ? (
          <ThemedView type="backgroundElement" style={styles.blockedCard}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              That reads better. Send when you&apos;re ready.
            </ThemedText>
          </ThemedView>
        ) : null}
      </StepScreen>

      {/* Mid-session: the cap fired on Send, after two minutes of writing.
          An OPAQUE overlay in the same tree, not an early return and not a
          <Sheet>: the early return unmounted the composer and destroyed the
          draft, and a Modal presented from a screen that is already a
          presented route is the dead-app race the traps file documents. The
          message state lives on underneath, so "Keep my message" is just
          lifting the overlay. */}
      {capped != null ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.capOverlay,
            { backgroundColor: theme.background },
          ]}>
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
              More tomorrow. A few good ones beat a pile of forgettable ones. Yours is kept right
              here.
            </ThemedText>
          </View>
          <View style={styles.capActions}>
            <PrimaryButton label="Keep my message" onPress={() => setCapped(null)} />
            <PrimaryButton variant="ghost" label="Fair enough" onPress={() => router.back()} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** How long the confirmation holds before the composer dismisses itself. */
const CONFIRM_MS = 1100;

const styles = StyleSheet.create({
  composerRoot: {
    flex: 1,
  },
  capOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
  },
  capActions: {
    alignSelf: 'stretch',
    gap: Spacing.two,
  },
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
