import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import { MaxContentWidth, Space } from '@/constants/theme';
import { useOwnBusiness, useSavedReplies, useSetSavedReply } from '@/features/business/hooks';

const SLOTS = [0, 1, 2] as const;
const BODY_MAX = 500;

/**
 * Three replies an owner writes once and taps into any chat.
 *
 * A bar mid-service either answers in three taps or does not answer at all,
 * and the public rating that judges a business is largely a responsiveness
 * score. Messages to a business arrive with no accept gate, so every "do you
 * have beds tonight" lands as a fresh conversation with a blank composer.
 *
 * These are PRIVATE NOTES. Nothing typed here is delivered to anybody: the
 * chip puts the words in the composer, the owner reads them, changes the bit
 * that is wrong, and presses send. That is why the chip does not send on tap
 * (see features/chat/composer) and why the table is the owner's alone.
 */
export default function SavedRepliesScreen() {
  const business = useOwnBusiness();
  const businessId = business.data?.id ?? null;
  const replies = useSavedReplies(businessId);
  const save = useSetSavedReply(businessId);

  /**
   * What the OWNER has typed, per slot, and nothing else.
   *
   * Derived rather than seeded: a slot with no entry here shows the server's
   * answer, and one with an entry shows the typing. Mirroring the server into
   * state on arrival is the shape that needs an effect, and an effect that
   * calls setState is both a cascading render and a race - a refetch landing
   * mid-sentence would overwrite the sentence.
   */
  const [typed, setTyped] = useState<Record<number, string>>({});
  const saved = (slot: number) => replies.data?.find((r) => r.position === slot)?.body ?? '';
  const shown = (slot: number) => typed[slot] ?? saved(slot);

  if (replies.isError) {
    return (
      <ThemedView style={styles.root}>
        <Stack.Screen options={{ headerTitle: 'Quick replies' }} />
        <View style={styles.column}>
          <LoadError what="your replies" error={replies.error} onRetry={replies.refetch} />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ headerTitle: 'Quick replies' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.column}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Three answers you write once. They show above the keyboard in a chat, and tapping one
            puts it in the box so you can change it before it goes.
          </ThemedText>
          {SLOTS.map((slot) => (
            <FormTextField
              key={slot}
              label={`Reply ${slot + 1}`}
              placeholder={
                slot === 0 ? 'Beds tonight, yes. Come by after six.' : 'Another one you type a lot.'
              }
              value={shown(slot)}
              onChangeText={(text) => setTyped((prev) => ({ ...prev, [slot]: text }))}
              onBlur={() => {
                // Saved on blur, one slot at a time. An explicit Save for
                // three independent fields is a button that is wrong about
                // two of them.
                const body = shown(slot);
                if (body.trim() !== saved(slot)) {
                  save.mutate({ position: slot, body });
                }
              }}
              multiline
              maxLength={BODY_MAX}
            />
          ))}
          <ThemedText type="caption" themeColor="textSecondary">
            Leave one empty to take it off the row.
          </ThemedText>
          <PrimaryButton variant="ghost" label="Done" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingVertical: Space.lg },
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Space.lg,
    gap: Space.lg,
  },
});
