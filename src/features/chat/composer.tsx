import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { ThemedText } from '@/components/themed-text';
import { PhotoButton } from '@/components/ui/photo-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Fonts, HitTarget, Radius, Space, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ComposerDraft = { text: string; photoUri: string | null };

const BODY_MAX = 2000;

/**
 * The one composer, for a one-to-one chat and for a room alike.
 *
 * They had drifted, and the drift was not cosmetic. The one-to-one composer
 * staged a picked photo behind Send; the room's called `sendPhoto.mutate`
 * straight out of `onPick`, so choosing a photo in a group SENT it, and a
 * mis-tap could only be undone by unsending in front of everybody. Founder,
 * 2026-08-28: "when I send a photo in a group chat it sends the photo
 * immediately when I click on it, not after I click send like should be
 * required."
 *
 * A picked photo is a DRAFT here, always. Nothing leaves until Send.
 */
export function Composer({
  placeholder = 'Message…',
  allowPhotos = true,
  photoBusy = false,
  disabled = false,
  inputTestID,
  replyingTo,
  onCancelReply,
  savedReplies,
  onSend,
}: {
  placeholder?: string;
  /** False where the server refuses images anyway, as it does for a guest. */
  allowPhotos?: boolean;
  photoBusy?: boolean;
  disabled?: boolean;
  inputTestID?: string;
  /**
   * The message this one will answer, shown above the field. The reply itself
   * is the caller's: this only draws what was picked and offers the way out.
   */
  replyingTo?: { name: string; body: string | null } | null;
  onCancelReply?: () => void;
  /**
   * A business owner's three saved replies, or empty.
   *
   * Tapping one PUTS IT IN THE FIELD. It does not send: these are private
   * notes, and the whole point is that the owner reads it, changes the bit
   * that is wrong ("after six" becomes "after seven") and presses send
   * themselves. A chip that sent on tap would make a stored sentence into a
   * message nobody re-read, which is how a saved reply answers the wrong
   * question confidently.
   */
  savedReplies?: readonly { id: string; body: string }[];
  /**
   * Send it. Resolve and the staged photo is cleared; throw and it stays put
   * so the same picture can go again without being found a second time.
   */
  onSend: (draft: ComposerDraft) => Promise<void> | void;
}) {
  const theme = useTheme();
  // The field's type rides the scale like every other string in the app —
  // it was the one hardcoded font size left, so at the accessibility sizes
  // a 120pt box held about a line and a half of the message being composed,
  // on a product where every first message is moderated and has to be right
  // first time. Four lines' worth of room, growing with fontScale, clamped
  // to a third of the window so the box can never eat the thread.
  const { fontScale, height } = useWindowDimensions();
  const inputMaxHeight = Math.min(
    4 * Type.callout.lineHeight * fontScale + 2 * Spacing.two,
    height / 3
  );
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);

  const canSend = (draft.trim().length > 0 || attachment != null) && !disabled;

  const submit = async () => {
    if (!canSend) {
      return;
    }
    const text = draft.trim();
    const photoUri = attachment;
    // The words go before the round trip, not after: the bubble is already on
    // screen, and leaving them in the box as well shows the same sentence
    // twice and makes Send feel like it did not take. A failure keeps them in
    // the failed bubble, which is where the retry lives.
    setDraft('');
    try {
      await onSend({ text, photoUri });
      setAttachment(null);
    } catch {
      // The picture is held on purpose: a photo has no failed bubble to live
      // in, so clearing it would lose it and send the person off to find it
      // again.
      //
      // And now that a caption travels WITH its photo in one message, the
      // words have to be held with it. Cleared, the retry would send the
      // picture on its own and the sentence somebody wrote would be gone
      // with no failed bubble anywhere to hold it. Text on its own is
      // different: it already has a bubble, greyed, with the retry on it.
      //
      // Functional, because the send is awaited and somebody may have started
      // typing the next thing while it was in flight. What they are writing
      // now wins.
      if (photoUri) {
        setDraft((current) => (current.length > 0 ? current : text));
      }
    }
  };

  return (
    <View>
      {/* Above the field and below the reply banner, so the row a thumb
          reaches first is the one nearest the keyboard. Hidden once there is
          anything in the field: they are a way to START an answer, and a strip
          of chips over a half-typed sentence is chrome in the way. */}
      {savedReplies && savedReplies.length > 0 && draft.length === 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chipRow}>
          {savedReplies.map((reply) => (
            <PressableScale
              key={reply.id}
              accessibilityRole="button"
              accessibilityLabel={`Use saved reply: ${reply.body}`}
              haptic="light"
              scaleTo={0.97}
              onPress={() => setDraft(reply.body)}
              style={[styles.chip, { backgroundColor: theme.surfaceSunken }]}>
              <ThemedText type="footnote" numberOfLines={1} style={styles.chipText}>
                {reply.body}
              </ThemedText>
            </PressableScale>
          ))}
        </ScrollView>
      ) : null}
      {replyingTo ? (
        <View style={[styles.replyBanner, { borderLeftColor: theme.accent }]}>
          <View style={styles.replyText}>
            <ThemedText type="caption" themeColor="accent" numberOfLines={1}>
              {`Replying to ${replyingTo.name}`}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
              {replyingTo.body ?? 'Message no longer here'}
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            // Says what happens, and names what it lets go of: two identical
            // "Close" labels on one screen are ambiguous under VoiceOver.
            accessibilityLabel={`Stop replying to ${replyingTo.name}`}
            hitSlop={10}
            onPress={onCancelReply}>
            <SymbolView
              name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
              size={20}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        </View>
      ) : null}
      {attachment ? (
        <View style={styles.attachmentRow}>
          <View style={styles.attachment}>
            <Image source={{ uri: attachment }} style={styles.fill} contentFit="cover" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              hitSlop={8}
              onPress={() => setAttachment(null)}
              style={styles.attachmentRemove}>
              <SymbolView
                name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
                size={22}
                tintColor={theme.text}
              />
            </Pressable>
          </View>
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.attachmentNote}>
            Tap send when you&apos;re ready.
          </ThemedText>
        </View>
      ) : null}
      <View style={styles.composer}>
        {allowPhotos ? (
          <PhotoButton busy={photoBusy} disabled={attachment != null} onPick={setAttachment} />
        ) : null}
        <TextInput
          testID={inputTestID}
          style={[
            styles.input,
            {
              color: theme.text,
              backgroundColor: theme.surfaceSunken,
              fontFamily: Fonts?.sans,
              maxHeight: inputMaxHeight,
            },
          ]}
          placeholder={attachment ? 'Add a message…' : placeholder}
          placeholderTextColor={theme.textSecondary}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={BODY_MAX}
          // Multiline: Return inserts a newline, so the keyboard has no exit
          // of its own and dragging the thread was the only one, which
          // nothing on screen says.
          {...keyboardDoneProps}
        />
        {/* Disabled is expressed by COLOUR, never by opacity. `opacity: 0.4`
            dims the label and the ground together and lands at 2.35:1 on this
            canvas, under the 3:1 floor for a control, while still looking
            completely tappable — the trap this repo has already measured once
            in PrimaryButton. The arrow's tint has to move with the fill or the
            same collapse comes back at a different value.

            Layout goes on containerStyle and paint on style, because
            PressableScale scales an INNER view: sizing only the inner one
            shrinks the touch target mid-press and drops taps. */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Send"
          // 40pt drawn, 44pt to hit.
          hitSlop={2}
          scaleTo={0.9}
          haptic="soft"
          onPress={submit}
          disabled={!canSend}
          containerStyle={styles.sendTarget}
          style={[
            styles.sendButton,
            { backgroundColor: canSend ? theme.accentDeep : theme.surfaceSunken },
          ]}>
          <SymbolView
            name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
            size={18}
            tintColor={canSend ? theme.onAccentDeep : theme.textSecondary}
          />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingBottom: Space.sm,
  },
  chip: {
    maxWidth: 260,
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.sm,
  },
  chipText: {
    // One line: the chip is a handle for a sentence, not the sentence.
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    minHeight: 40,
    // maxHeight is inline: it scales with fontScale. fontSize comes from the
    // scale (Type.callout) — nothing in the app hardcodes a font size.
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: Type.callout.fontSize,
  },
  sendTarget: {
    width: 40,
    height: 40,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
    paddingLeft: Spacing.two,
    borderLeftWidth: 2,
  },
  replyText: {
    flex: 1,
    gap: 1,
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  attachment: {
    width: 64,
    height: 64,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  attachmentRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
  },
  attachmentNote: {
    flex: 1,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
