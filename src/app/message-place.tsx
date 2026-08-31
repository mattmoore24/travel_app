import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Space } from '@/constants/theme';
import { useBusinessDetail, useMessageBusiness } from '@/features/business/hooks';
import { waitNote } from '@/features/business/vocabulary';
import { useDraftWarning } from '@/features/matching/hooks';
import { blockedCopy, riskyCopy } from '@/features/matching/moderation-copy';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

const MESSAGE_MAX = 500;

/**
 * Writing to the people who run a place.
 *
 * Same composer as saying hi to a traveler, with the two things that make a
 * person a person taken out. There is no profile to reply to, so nothing to
 * anchor the message on. And it is not held for anybody's yes: the prefilter
 * runs, the chat opens, the message is already in it. Which is why this
 * screen has no confirmation of its own - it hands you the chat instead.
 */
export default function MessagePlaceScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string; businessId?: string; name?: string }>();
  const businessId = params.id ?? params.businessId ?? null;
  // Unconditional: the ordinary path arrives from the business page, so this
  // is a cache read - and the detail carries the hours the wait note reads.
  const { data: place } = useBusinessDetail(businessId);
  const name = params.name ?? place?.name ?? null;
  // "Closed right now" only when the business's own hours say so, in the
  // business's own time. Unknown hours say nothing at all.
  const wait = place ? waitNote(place.hours, new Date(), place.lng) : null;

  const messagePlace = useMessageBusiness();
  const [message, setMessage] = useState('');
  const [blockedNotice, setBlockedNotice] = useState(false);
  // Which kind of wrong the server named for the refusal, so the card can
  // say it. Never the matched phrase.
  const [refusedCategory, setRefusedCategory] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Asked while the sentence is still being written, so something the
  // prefilter would stop becomes a reword rather than a refusal. Advisory
  // only: the send path runs the same check server-side either way.
  const { risky, category: draftCategory } = useDraftWarning(message, !blockedNotice);

  const submit = async () => {
    if (!businessId || message.trim().length === 0) {
      return;
    }
    setBlockedNotice(false);
    try {
      const result = await messagePlace.mutateAsync({ businessId, body: message.trim() });
      if (result.blocked) {
        haptics.error();
        setRefusedCategory(result.category ?? null);
        setBlockedNotice(true);
        // The notice renders under a field that is usually taller than what
        // is left of the screen, so without this a refusal looks like a tap
        // that did nothing.
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
        return;
      }
      haptics.success();
      router.replace(`/chat/${result.chat_id}`);
    } catch {
      // Every database refusal, the ten-a-day cap included, reaches the
      // person through the global mutation alert in the words the server
      // chose. Saying it twice would be two different sentences.
    }
  };

  return (
    <StepScreen
      scrollRef={scrollRef}
      title={name ?? 'This business'}
      subtitle="Goes to the people who run it. You'll find it on the Chat tab."
      continueLabel="Send"
      continueDisabled={!businessId || message.trim().length === 0 || message.length > MESSAGE_MAX}
      continueLoading={messagePlace.isPending}
      onClose={() => router.back()}
      onContinue={submit}>
      {wait ? (
        <ThemedText type="small" themeColor="textSecondary">
          {wait}
        </ThemedText>
      ) : null}
      <FormTextField
        label="Your message"
        multiline
        numberOfLines={4}
        style={styles.messageInput}
        placeholder="Ask them anything. Beds, tables, what's on tonight."
        value={message}
        onChangeText={setMessage}
        {...keyboardDoneProps}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {message.length}/{MESSAGE_MAX}
      </ThemedText>

      {risky && !blockedNotice ? (
        <ThemedView type="backgroundElement" style={styles.blockedCard}>
          <ThemedText type="smallBold" style={{ color: theme.highlight }}>
            {riskyCopy(draftCategory).title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {riskyCopy(draftCategory).body}
          </ThemedText>
        </ThemedView>
      ) : null}

      {blockedNotice ? (
        <ThemedView type="backgroundElement" style={styles.blockedCard}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            {/* When the card shows because the PREVIEW flagged a rewrite, speak
                the rewrite's category, not the old refusal's: a come-on rewritten
                from something explicit must not be called explicit. */}
            {blockedCopy(risky && draftCategory != null ? draftCategory : refusedCategory).title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {blockedCopy(risky && draftCategory != null ? draftCategory : refusedCategory).body}
          </ThemedText>
        </ThemedView>
      ) : null}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  messageInput: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  blockedCard: {
    gap: Space.xs,
    padding: Space.lg,
    borderRadius: Radius.lg,
  },
});
