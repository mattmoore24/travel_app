import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { ThemedText } from '@/components/themed-text';
import { PhotoButton } from '@/components/ui/photo-button';
import { Fonts, Radius, Spacing } from '@/constants/theme';
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
  onSend,
}: {
  placeholder?: string;
  /** False where the server refuses images anyway, as it does for a guest. */
  allowPhotos?: boolean;
  photoBusy?: boolean;
  disabled?: boolean;
  inputTestID?: string;
  /**
   * Send it. Resolve and the staged photo is cleared; throw and it stays put
   * so the same picture can go again without being found a second time.
   */
  onSend: (draft: ComposerDraft) => Promise<void> | void;
}) {
  const theme = useTheme();
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
      // Held on purpose. A photo has no failed bubble to live in, so
      // clearing it here would lose the picture and make the person go and
      // find it again.
    }
  };

  return (
    <View>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          // 40pt drawn, 44pt to hit.
          hitSlop={2}
          onPress={submit}
          disabled={!canSend}
          style={[
            styles.sendButton,
            { backgroundColor: theme.accentDeep, opacity: canSend ? 1 : 0.4 },
          ]}>
          <SymbolView
            name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
            size={18}
            tintColor={theme.onAccentDeep}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    maxHeight: 120,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
