import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { StepScreen } from '@/components/form/step-screen';
import { PressableScale } from '@/components/ui/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import {
  useOwnUserId,
  useProfilePriorities,
  useRemoveProfilePriority,
  useSaveProfilePriority,
} from '@/features/profile/hooks';
import {
  MAX_PRIORITIES,
  PRIORITY_MAX,
  priorityPlaceholder,
  validatePriority,
} from '@/features/profile/priorities';
import { nextFreeSlot } from '@/features/profile/slots';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

/**
 * The whole list on one screen.
 *
 * The founder's ask was that adding up to six be EASY, and the obvious build
 * is the one that fails it: a modal per entry, the way one prompt is edited,
 * costs six screen transitions and about twenty taps. So instead there is one
 * empty field at the end of the list, and its Return key commits the row and
 * puts the cursor in a fresh one. Six entries is six lines of typing with
 * nothing in between.
 *
 * Rows save on their own rather than behind one Save button, for three
 * reasons: there is nothing else on the screen to save atomically; somebody
 * who types four plans and swipes the sheet away should keep four plans (the
 * discard-guard on edit-profile exists because that screen holds a bio
 * somebody spent five minutes on, and a twenty-character chip is not that);
 * and the screening trigger can refuse ONE row, which lands on the row that
 * caused it while the others stay safe.
 */
export default function EditPrioritiesScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ slot?: string }>();
  const userId = useOwnUserId();
  const { data: priorities = [] } = useProfilePriorities(userId);
  const save = useSaveProfilePriority();
  const remove = useRemoveProfilePriority();

  // Drafts live here, keyed by slot, so a row being edited does not snap back
  // when the query refetches after its neighbour saves.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string | null>>({});
  const [pending, setPending] = useState('');
  const [pendingError, setPendingError] = useState<string | null>(null);
  const pendingRef = useRef<TextInput>(null);
  const rowRefs = useRef<Record<number, TextInput | null>>({});

  // `justWrote` covers the gap between an upsert and its refetch: the slot we
  // wrote a moment ago is not in `priorities` yet. Two entries typed faster
  // than the refetch both read length 0, and the upsert on (user_id, slot)
  // meant the second silently replaced the first.
  const justWrote = useRef<number[]>([]);
  const taken = [...priorities.map((p) => p.slot), ...justWrote.current];
  const nextSlot = nextFreeSlot(taken, MAX_PRIORITIES);
  // Counted the same way the slot is. `priorities.length` alone disagreed
  // with `nextSlot` for exactly one refetch after the sixth was typed, and
  // the empty field stayed on screen — so a seventh entry fell through to the
  // `?? MAX - 1` fallback and overwrote the sixth.
  const full = nextSlot == null;

  // Arriving from a chip on the profile: put the cursor in that row, or in
  // the empty field when the section header sent us here with nothing.
  const focusSlot = params.slot != null ? Number(params.slot) : null;
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) {
      return;
    }
    focused.current = true;
    if (focusSlot != null) {
      rowRefs.current[focusSlot]?.focus();
    } else {
      // The header sent us here with nothing to edit, which means "I want to
      // add one". The comment claimed this happened; the early return on an
      // empty list meant it never did, so the screen opened with no keyboard
      // and somebody had to find the field and tap it.
      pendingRef.current?.focus();
    }
  }, [focusSlot]);

  const textOf = (slot: number, stored: string) => drafts[slot] ?? stored;

  const commitRow = async (slot: number, stored: string) => {
    const value = textOf(slot, stored).trim();
    if (value === stored.trim()) {
      return;
    }
    const problem = validatePriority(value);
    if (problem) {
      setErrors((e) => ({ ...e, [slot]: problem }));
      return;
    }
    try {
      await save.mutateAsync({ slot, text: value });
      setErrors((e) => ({ ...e, [slot]: null }));
    } catch (error) {
      // The screening trigger speaks in a sentence meant for a person, so it
      // goes under the row that caused it rather than into an alert.
      setErrors((e) => ({ ...e, [slot]: messageFor(error) }));
    }
  };

  /**
   * Commit every row that has been typed into.
   *
   * Needed before a removal, because removing renumbers the slots and the
   * drafts are keyed by slot. It is also not optional: the scroller uses
   * `keyboardShouldPersistTaps="always"`, so tapping the minus on one row
   * does NOT blur the field you are typing in, and without this an unsaved
   * edit on a different row would be silently thrown away by the renumber.
   */
  const commitDirtyRows = async () => {
    for (const priority of priorities) {
      await commitRow(priority.slot, priority.text);
    }
    // The rows as they now stand, NOT `priorities`, which is the render-time
    // snapshot the writes above have not reached yet — the invalidation's
    // refetch cannot land inside this handler. Renumbering from the snapshot
    // wrote the pre-edit text back over the edit that had just been saved.
    return priorities.map((priority) => ({
      ...priority,
      text: textOf(priority.slot, priority.text).trim() || priority.text,
    }));
  };

  const commitPending = async ({ keepGoing }: { keepGoing: boolean }) => {
    const value = pending.trim();
    if (value.length === 0) {
      return;
    }
    const problem = validatePriority(value);
    if (problem) {
      setPendingError(problem);
      return;
    }
    // No free slot means the list filled up while this was being typed, and
    // there is no honest place to put it. Writing it anyway is what used to
    // overwrite the sixth.
    const slot = nextSlot;
    if (slot == null) {
      setPendingError('That is all six. Clear one to add another.');
      return;
    }
    try {
      await save.mutateAsync({ slot, text: value });
      justWrote.current = [...justWrote.current, slot];
      haptics.light();
      setPending('');
      setPendingError(null);
      // Straight back into the empty field, which is the whole point of the
      // screen. Without this, adding six means six taps to refocus.
      if (keepGoing && slot + 1 < MAX_PRIORITIES) {
        pendingRef.current?.focus();
      }
    } catch (error) {
      setPendingError(messageFor(error));
    }
  };

  return (
    <StepScreen
      title="Top priorities"
      subtitle="Places, food, a night out, the one thing you'd hate to miss. Someone who wants the same thing can say they're in."
      continueLabel="Done"
      onContinue={async () => {
        await commitPending({ keepGoing: false });
        router.back();
      }}
      onClose={async () => {
        await commitPending({ keepGoing: false });
        router.back();
      }}>
      <View style={styles.list}>
        {priorities.map((priority) => (
          <View key={priority.slot} style={styles.row}>
            <View style={styles.field}>
              <FormTextField
                inputRef={(ref) => {
                  rowRefs.current[priority.slot] = ref;
                }}
                value={textOf(priority.slot, priority.text)}
                onChangeText={(text) => {
                  setDrafts((d) => ({ ...d, [priority.slot]: text }));
                  setErrors((e) => ({ ...e, [priority.slot]: null }));
                }}
                onBlur={() => commitRow(priority.slot, priority.text)}
                onSubmitEditing={() => commitRow(priority.slot, priority.text)}
                error={errors[priority.slot] ?? null}
                maxLength={PRIORITY_MAX}
                returnKeyType="done"
                autoCapitalize="none"
                {...keyboardDoneProps}
              />
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Remove "${priority.text}"`}
              haptic="light"
              scaleTo={0.9}
              hitSlop={12}
              onPress={async () => {
                const committed = await commitDirtyRows();
                setDrafts({});
                setErrors({});
                justWrote.current = [];
                remove.mutate({
                  slot: priority.slot,
                  rows: committed.map((row) => ({ slot: row.slot, text: row.text })),
                });
              }}>
              <SymbolView
                name={{ ios: 'minus.circle.fill', android: 'remove_circle', web: 'remove_circle' }}
                size={22}
                tintColor={theme.textTertiary}
              />
            </PressableScale>
          </View>
        ))}

        {full ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            That&apos;s six. Remove one if you want to swap it out.
          </ThemedText>
        ) : (
          <View style={styles.row}>
            <View style={styles.field}>
              <FormTextField
                inputRef={pendingRef}
                value={pending}
                onChangeText={(text) => {
                  setPending(text);
                  setPendingError(null);
                }}
                // blurOnSubmit={false} is what keeps the keyboard up between
                // rows. Without it iOS dismisses it on every Return and the
                // "six lines of typing" turns into six taps and six waits.
                blurOnSubmit={false}
                onSubmitEditing={() => commitPending({ keepGoing: true })}
                onBlur={() => commitPending({ keepGoing: false })}
                error={pendingError}
                placeholder={priorityPlaceholder(nextSlot ?? MAX_PRIORITIES - 1)}
                maxLength={PRIORITY_MAX}
                returnKeyType="next"
                autoCapitalize="none"
                testID="new-priority"
                {...keyboardDoneProps}
              />
            </View>
            {/* The remove button's width, so the empty field lines up with
                the rows above it instead of stretching past them. */}
            <View style={styles.removeSpacer} />
          </View>
        )}
      </View>
    </StepScreen>
  );
}

/**
 * The DB speaks in sentences meant for a person; anything else is generic.
 *
 * Duck-typed, NOT `instanceof Error`. supabase-js returns a plain parsed
 * object on the non-throwing path — `PostgrestError` is only constructed
 * under `shouldThrowOnError` — so the instanceof check was always false and
 * this always said "Couldn't save that", underneath a global alert that was
 * simultaneously showing the real sentence. Two explanations at once, one of
 * them wrong.
 */
function messageFor(error: unknown): string {
  const message =
    typeof (error as { message?: unknown } | null)?.message === 'string'
      ? (error as { message: string }).message
      : '';
  return message.includes('community guidelines')
    ? 'That one breaks our community guidelines.'
    : "Couldn't save that. Try again.";
}

const styles = StyleSheet.create({
  list: {
    gap: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  field: {
    flex: 1,
  },
  removeSpacer: {
    width: 22,
  },
});
