import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Motion, Radius, Space } from '@/constants/theme';
import type { MeetAnswer } from '@/features/matching/api';
import { useAnswerMeetPrompt } from '@/features/matching/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

/**
 * The one question the founder has no answer to: did anybody actually get a
 * coffee out of this.
 *
 * §6 counts hellos and accepts. Those can both climb while nobody in the city
 * ever meets anybody, and the number that says the product works is the one
 * nothing collects. This card is its only source, so an answer that never
 * reaches a person is a table nobody writes to: meet_prompt_due() and
 * answer_meet_prompt() shipped in 20260902240000 with a 34-assertion pgTAP
 * suite and, until this file, no caller anywhere in the app.
 *
 * WHAT IT MUST NOT SAY, and each of these is a §7 rule rather than a taste
 * call:
 *
 *   * Nothing about the other traveler. Not that they were asked, not that
 *     they answered, not what they said. Their answer is unreadable to this
 *     device by policy (chat_meet_answers_select_own), and the card must not
 *     restore in words what the database refuses in rows.
 *   * No claim that the answer travels. It reaches an aggregate and stops:
 *     admin_meet_answers is months and counts, revoked from every client
 *     role. "Nobody else sees your answer" is therefore a fact, not a
 *     reassurance.
 *   * No accusation, in either direction. "Did you two end up meeting" is a
 *     question about a trip. "Did they show up" would be a question about a
 *     person, and the moment this reads as a rating of somebody the product
 *     is a different product.
 *
 * ASKED ONCE. There is no close button on purpose. A dismissal that wrote
 * nothing would come back on the next launch, because "have they answered" is
 * the server's own memory and the server would still be waiting; and a
 * dismissal that wrote something would be a fourth answer nobody chose. "Not
 * sure" is the way out, and answering is what makes the card permanent
 * history: there is no update policy and no delete grant on the row, so the
 * first answer stands forever and meet_prompt_due() never returns true for
 * this chat again.
 *
 * The card only ever appears on `useMeetPromptDue(...).data === true`, so
 * every rule about WHEN to ask - the day after the last shared date, the
 * thirty day tail, never after a block or a report, never a room and never a
 * business - lives in SQL and is proved against a real cluster in
 * supabase/tests/database/61_did_you_two_actually_meet.test.sql. Nothing here
 * derives any part of it.
 */

/**
 * Three answers, and the spoken name each one needs.
 *
 * "Yes" alone is not an accessible name: out of context VoiceOver would read
 * three buttons called Yes, No and Not sure with nothing saying what they
 * answer. Each spoken label CONTAINS its visible word, which is WCAG 2.5.3 -
 * the rule the Top priorities chip failed by displaying "Reply" and speaking
 * "Say you're in".
 */
const ANSWERS: readonly { value: MeetAnswer; label: string; spoken: string }[] = [
  { value: 'yes', label: 'Yes', spoken: 'Yes, we met' },
  { value: 'no', label: 'No', spoken: 'No, we did not' },
  { value: 'unsure', label: 'Not sure', spoken: 'Not sure' },
];

export function MeetPrompt({ chatId }: { chatId: string }) {
  const theme = useTheme();
  const answer = useAnswerMeetPrompt();

  return (
    <Animated.View entering={FadeIn.duration(Motion.standard)}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="callout">Did you two end up meeting?</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Nobody else sees your answer. It is the only way we know whether Samewhere works.
        </ThemedText>
        <View style={styles.answers}>
          {ANSWERS.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={option.spoken}
              accessibilityState={{ disabled: answer.isPending }}
              disabled={answer.isPending}
              // 36pt of pill plus 4 a side is the 44 every control here buys.
              hitSlop={{ top: 4, bottom: 4 }}
              onPress={() => {
                haptics.selection();
                answer.mutate({ chatId, answer: option.value });
              }}
              style={({ pressed }) => [
                styles.answer,
                {
                  // Colour, never alpha. Fading a control dims its label and
                  // its ground together and collapses the contrast between
                  // them toward 1:1 - measured at 2.35:1 on this ground, under
                  // the 3:1 floor and still looking tappable. While the write
                  // is in flight the edge drops to the decorative hairline and
                  // the word to textSecondary, which reads as unavailable at
                  // 8.2:1 rather than as faint.
                  borderColor: answer.isPending ? theme.hairline : theme.border,
                  backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                },
              ]}>
              <ThemedText
                type="footnote"
                style={[
                  styles.answerLabel,
                  { color: answer.isPending ? theme.textSecondary : theme.text },
                ]}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </ThemedView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Space.lg,
    marginTop: Space.md,
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    gap: Space.sm,
  },
  answers: {
    flexDirection: 'row',
    // Wraps rather than squeezing: three pills at large Dynamic Type do not
    // fit one line on a small phone, and a squeezed pill truncates the only
    // word on it.
    flexWrap: 'wrap',
    gap: Space.sm,
    marginTop: Space.xs,
  },
  answer: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    // The pill's ground is the card's own, so its edge is the whole control.
    // `border` draws that at 3.4:1; hairline is decorative and would not.
    borderWidth: 1,
  },
  answerLabel: {
    fontWeight: '600',
  },
});
