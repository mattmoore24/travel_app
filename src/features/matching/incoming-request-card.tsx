import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { HitTarget, Motion, Radius, Space, Spacing } from '@/constants/theme';
import { anchorAboutYours } from '@/features/chat/anchors';
import { Avatar } from '@/features/chat/chat-row';
import { rowTimestamp } from '@/features/chat/separators';
import { useAnnounce } from '@/features/chat/use-announce';
import { useRespondToRequest } from '@/features/matching/hooks';
import { overlapSentence } from '@/features/matching/overlap';
import { matchesMutedWord, useMutedWords } from '@/features/profile/muted-words';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { IncomingRequestRow } from '@/lib/database.types';

/**
 * How long a decline stands undoable before it is written.
 *
 * The same five seconds the Travelers undo bar spends, for the same reason:
 * long enough to notice and reach, short enough that it never becomes a
 * decision you are still holding.
 */
export const DECLINE_UNDO_MS = 5000;

/** Past this many lines the first message is folded and can be opened. */
const MESSAGE_LINES = 4;

/**
 * The height the message slot holds while the reader's own word list is still
 * being fetched.
 *
 * Roughly the fold block's own height, so the card does not jump by a visible
 * amount when the answer arrives either way.
 */
const FOLD_HEIGHT = 56;

/**
 * A hello somebody sent you, and the two answers to it.
 *
 * It carries the fact the whole product is built on: the city you are both
 * in and the dates you share it, in the SAME sentence the traveler card
 * built when the hello was sent (features/matching/overlap). A hello that
 * came from a pin rather than a trip match has no readable overlap, so the
 * chip is simply absent rather than guessed at.
 *
 * Declining is deferred, not reversed. respond_to_message_request has one
 * arm and unique(sender_id, recipient_id) makes the row permanent, so a
 * mis-tap used to be forever. The write is held for DECLINE_UNDO_MS and then
 * fired — by the timer, or by unmount, whichever comes first. It is never
 * silently dropped: a decline the sender's screen has already stopped
 * showing must still be a decline.
 *
 * What this card must NEVER do is tell the sender anything. Nothing here
 * writes back to them: not a read, not a decline, not the fold.
 */
export function IncomingRequestCard({ request }: { request: IncomingRequestRow }) {
  const theme = useTheme();
  const respond = useRespondToRequest();
  const [accepting, setAccepting] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The reader's own line, applied here and nowhere else. This is NOT
  // moderation and it does not stand in for any: hard rule 5 means this
  // message was already classified before it was delivered, and what happens
  // below happens afterwards, on this phone, at render. It folds. It deletes
  // nothing, it declines nothing, and nothing about it reaches the sender -
  // their profile, the report link, Decline and Accept are all exactly where
  // they were.
  const muted = useMutedWords();
  const [readAnyway, setReadAnyway] = useState(false);
  // THREE states, not two. Defaulting the list to [] while the query is still
  // in the air made `mutedBy` null on the first render, so the message painted
  // in full and folded itself a round trip later - on every cold open of the
  // inbox, which is the one time the list is not already cached. The words
  // were on screen, and readable by VoiceOver, before anything hid them.
  //
  // "Not yet known" is therefore its own state and the message waits in it.
  // A list that is not coming at all is NOT that state: a query that is
  // disabled (no session, no Supabase) or that has failed answers with no
  // list, and the hello is shown, because holding every first message behind
  // a request that will not arrive would be a worse answer than the one this
  // whole feature exists to soften.
  const checkingList = muted.data === undefined && muted.isLoading;
  const mutedBy =
    readAnyway || muted.data === undefined
      ? null
      : matchesMutedWord(request.first_message, muted.data);
  // Is the message longer than the fold? Measured UNCLAMPED, by the hidden
  // copy below. React Native reports lines AFTER truncation, so asking the
  // clamped Text how many lines it has can never answer more than
  // MESSAGE_LINES: a message exactly four lines long was marked folded and
  // handed the reader an affordance that opened nothing.
  const [folded, setFolded] = useState(false);
  const [measured, setMeasured] = useState(false);

  // Say the transition out loud. The button that was activated is unmounted
  // by this very change, so VoiceOver focus is dropped to the top of the
  // screen and the reader is left with no idea whether the decline landed or
  // that there is a way back from it.
  useAnnounce(declined ? 'Declined. You can undo for five seconds.' : null);

  // The deferred decline. Held in refs so the unmount cleanup can flush it
  // without re-running on every render: `mutate` is bound once by the
  // mutation observer, so the first render's copy is the right one forever.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const fire = useRef(respond.mutate);
  const mounted = useRef(true);
  useEffect(() => {
    fire.current = respond.mutate;
  });

  // One flush, three callers: the undo window running out, this card
  // unmounting, and the app leaving the foreground. A ref so the AppState
  // subscription and the unmount cleanup can both hold it without
  // re-subscribing on every render.
  const flush = useRef(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const id = pending.current;
    pending.current = null;
    if (!id) {
      return;
    }
    fire.current(
      { requestId: id, accept: false },
      {
        // A decline that did not land must stop reading as one that did.
        // Offline, or a row that is already gone, used to leave the card
        // sitting on "Declined" while the hello was still in the inbox on
        // the next launch: the reader had made a decision the app had
        // quietly failed to carry out, and nothing said so.
        onError: () => {
          if (mounted.current) {
            setDeclined(false);
          }
        },
      }
    );
  });

  // Terminated inside the undo window is still a decline. iOS gives an app
  // no notice at all of a swipe-up kill, so the move out of 'active' is the
  // last moment anything can be written — and it is the same moment the
  // reader stops being able to undo.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        flush.current();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(
    () => () => {
      mounted.current = false;
      flush.current();
    },
    []
  );

  const name = request.display_name ?? 'Traveler';
  const overlap = overlapSentence(request.overlap_city, request.overlap_start, request.overlap_end);
  const arrived = rowTimestamp(request.created_at);

  const accept = async () => {
    setAccepting(true);
    try {
      const result = await respond.mutateAsync({ requestId: request.id, accept: true });
      if (result.accepted && result.chat_id) {
        haptics.success();
        router.push(`/chat/${result.chat_id}`);
      }
    } catch {
      // Surfaced by the global mutation error alert.
    } finally {
      setAccepting(false);
    }
  };

  const decline = () => {
    haptics.selection();
    setDeclined(true);
    pending.current = request.id;
    timer.current = setTimeout(() => flush.current(), DECLINE_UNDO_MS);
  };

  const undo = () => {
    haptics.selection();
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    setDeclined(false);
  };

  if (declined) {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <Animated.View entering={FadeIn.duration(Motion.quick)} style={styles.declinedRow}>
          <ThemedText type="footnote" numberOfLines={1} style={styles.declinedText}>
            Declined
          </ThemedText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Undo declining ${name}`}
            haptic="none"
            scaleTo={0.96}
            onPress={undo}
            style={styles.undoButton}>
            <ThemedText type="smallBold" themeColor="accent">
              Undo
            </ThemedText>
          </PressableScale>
        </Animated.View>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${request.display_name ?? 'traveler'}'s full profile`}
          onPress={() => router.push(`/profile/${request.sender_id}`)}
          style={({ pressed }) => [styles.headerPerson, pressed && styles.pressed]}>
          <Avatar path={request.photo_path} />
          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <ThemedText type="smallBold">
                {request.display_name ?? 'Traveler'}
                {request.age != null ? `, ${request.age}` : ''}
              </ThemedText>
              {request.verified ? (
                <VerifiedSeal name={request.display_name} age={request.age} />
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {request.profile_element
                ? `about ${anchorAboutYours(request.profile_element)} · `
                : ''}
              view full profile
            </ThemedText>
          </View>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={14}
            tintColor={theme.textSecondary}
          />
        </Pressable>
        {/* Outside the pressable on purpose: a Pressable carrying its own
            accessibilityLabel swallows the text inside it, and when a hello
            arrived is a fact the reader is entitled to hear as well as see.
            A three-week-old hello from a city you have left should not look
            as urgent as one from an hour ago. */}
        {arrived ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {arrived}
          </ThemedText>
        ) : null}
      </View>
      {/* The premise of the app, on the screen where it is decided. The same
          builder the traveler card uses, so the two can never word it
          differently about the same pair of people. */}
      {overlap ? (
        <View style={[styles.overlapPill, { backgroundColor: theme.accent }]}>
          <ThemedText type="caption" style={{ color: theme.onAccent }}>
            {overlap}
          </ThemedText>
        </View>
      ) : null}
      {/* A word the reader asked not to see, so the words themselves are not
          on the screen yet. The one that caused it IS named, because a fold
          that will not say why reads as the app censoring people rather than
          as the reader's own setting - and it is named to the reader alone,
          on the reader's own device. The message is not rendered at all while
          this is up, so VoiceOver cannot read past the fold either - and that
          holds from the very first frame, because a placeholder holds the
          slot until the list is known. */}
      {checkingList ? (
        <Skeleton height={FOLD_HEIGHT} radius={Radius.md} />
      ) : mutedBy != null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Shows the message"
          onPress={() => {
            haptics.selection();
            setReadAnyway(true);
          }}
          style={({ pressed }) => [
            styles.folded,
            { backgroundColor: theme.surfaceSunken },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="footnote" themeColor="textSecondary">
            This uses a word on your list: {mutedBy}
          </ThemedText>
          <ThemedText type="footnote" themeColor="accent">
            Show what they wrote
          </ThemedText>
        </Pressable>
      ) : (
        <>
          {/* Folded at four lines. A 500-character first message is a fifth of a
          screen, and a stack of them is a wall between a returning traveler
          and the conversations they opened the app for. No accessibility
          label on the press: the message IS the label, and a label here
          would hide it from VoiceOver entirely. */}
          <Pressable
            accessibilityRole="button"
            accessibilityHint={expanded ? 'Folds the message back up' : 'Shows the whole message'}
            onPress={() => setExpanded((open) => !open)}>
            <ThemedText numberOfLines={expanded ? undefined : MESSAGE_LINES}>
              {request.first_message}
            </ThemedText>
            {/* Inside the Pressable, not beside it. It was a sibling of the
            thing it toggles, so the one part of the card that names the
            action was the one part that did not perform it: tapping the
            words did nothing at all. One target now carries both. */}
            {folded ? (
              <ThemedText type="footnote" themeColor="accent" style={styles.fold}>
                {expanded ? 'Show less' : 'Show the whole message'}
              </ThemedText>
            ) : null}
          </Pressable>
          {/* The measuring pass, for one render only. Same width, same type, no
          clamp — the visible Text above cannot answer this question about
          itself, because React Native counts lines after truncating and a
          four-line clamp reports four lines for a message of four, fourteen
          or four hundred. Out of flow so it changes no layout, and hidden
          from VoiceOver so the message is not read twice. */}
          {measured ? null : (
            <ThemedText
              style={styles.measure}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              onTextLayout={(event: NativeSyntheticEvent<TextLayoutEventData>) => {
                setFolded(event.nativeEvent.lines.length > MESSAGE_LINES);
                setMeasured(true);
              }}>
              {request.first_message}
            </ThemedText>
          )}
        </>
      )}
      {/* The receiver's half of moderation. This is the one screen in the app
          where a stranger's words arrive unasked-for, and until now the only
          answers on it were accept and decline — reporting meant going and
          finding the profile first. Asking the question out loud is also
          what makes people answer it (Tinder's version lifted reports 46%). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report this message"
        hitSlop={8}
        onPress={() =>
          router.push({
            pathname: '/report',
            params: { userId: request.sender_id, context: `request:${request.id}` },
          })
        }>
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.feelsOff}>
          Does this feel off? Tell us.
        </ThemedText>
      </Pressable>
      <View style={styles.actions}>
        <View style={styles.action}>
          {/* Deliberately not demoted further: primary-button renders ghost
              as transparent, unraised and 44pt against Accept's 52, with no
              press haptic of its own. The weight difference is already
              there; what was missing was a way back. */}
          <PrimaryButton
            variant="ghost"
            label="Decline"
            disabled={respond.isPending || accepting}
            onPress={decline}
          />
        </View>
        <View style={styles.action}>
          <PrimaryButton
            label="Accept"
            loading={accepting}
            disabled={respond.isPending || accepting}
            onPress={accept}
          />
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerPerson: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  overlapPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  fold: {
    // The card's own `gap` used to space this from the message; inside the
    // Pressable it needs its own.
    marginTop: Spacing.one,
  },
  folded: {
    gap: 2,
    padding: Space.md,
    borderRadius: Radius.md,
  },
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
  feelsOff: {
    textDecorationLine: 'underline',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
  declinedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: HitTarget,
  },
  declinedText: {
    flex: 1,
  },
  undoButton: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  pressed: {
    opacity: 0.7,
  },
});
