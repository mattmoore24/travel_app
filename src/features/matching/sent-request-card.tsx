import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Space } from '@/constants/theme';
import { useWithdrawHello } from '@/features/matching/hooks';

/**
 * Taking back a first message you have just sent.
 *
 * Inside a chat the app already lets a message be unsent, so it decided long
 * ago that taking words back is legitimate. The FIRST message was the one
 * exception: it sat under "You said hi" for ever with no way out, and it
 * deliberately says nothing about whether it was declined, read, or stopped
 * by moderation (invariants 4 and 5) - so "Sent" looks identical at day one
 * and at day ninety. This is the way out, offered at the moment it is most
 * wanted: the seconds after the composer closes, when somebody realises they
 * wrote to the wrong person or wrote the wrong thing.
 *
 * A control rather than a card, in a file named for the row it acts on. What
 * it owns is the WRITE and everything around it - the busy state that is a
 * colour rather than a fade, and the promise below about what may be said -
 * while the bar it sits in owns the sentence and the geometry, because that
 * bar shares a slot with another one and only the screen knows about that.
 *
 * WHAT MAY BE SAID, and it is the reason this is not three lines inline:
 * every word here is a fact about the SENDER's own action. The confirmation
 * is "Taken back", never "they didn't see it" - whether the other person read
 * it is not something this app knows, and implying it would turn the one
 * control that exists to reduce exposure into the read receipt the design
 * refuses. Nothing here reveals a read, a decline or a hold.
 *
 * The Chat tab's "You said hi" row wants this for an OLDER first message and
 * does not have it yet; the report's NEEDS WIRING section names the row. What
 * it needs is `useWithdrawHello`, not this component - a row is a row and a
 * floating bar is a floating bar.
 */
export function SentRequestCard({
  requestId,
  onTakenBack,
}: {
  /** The first message to take back. */
  requestId: string;
  /** The bar changes its own sentence to the past tense; this is the cue. */
  onTakenBack: () => void;
}) {
  const withdraw = useWithdrawHello();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Take it back"
      accessibilityState={{ disabled: withdraw.isPending }}
      disabled={withdraw.isPending}
      haptic="light"
      scaleTo={0.96}
      onPress={() =>
        withdraw.mutate(
          { requestId, surface: 'said_hi_strip' },
          // `false` from the server is not a failure to show anybody: it
          // means the row was already taken back or already answered, and it
          // is deliberately the same answer for both so a sender can never
          // read a decline out of it. Either way the words are not going
          // anywhere new, so the bar says so. A thrown error is a different
          // thing and the mutation's own failureTitle handles it.
          { onSuccess: onTakenBack }
        )
      }
      style={styles.action}>
      {/* Colour, never alpha. Fading a label dims it and its ground together,
          so `opacity` cannot say "busy" without also saying "unreadable" -
          measured at 2.3:1 on this ground, still perfectly tappable-looking. */}
      <ThemedText type="smallBold" themeColor={withdraw.isPending ? 'textSecondary' : 'accent'}>
        Take it back
      </ThemedText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.sm,
  },
});
