import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadError } from '@/components/ui/load-error';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Space } from '@/constants/theme';
import {
  MUTED_WORDS_MAX,
  MUTED_WORD_MAX,
  normalizeMutedWord,
  useMutedWords,
  useSetMutedWords,
} from '@/features/profile/muted-words';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { countOf } from '@/lib/plural';

/**
 * Your own line, on top of the one the app draws for everybody.
 *
 * The classifier is tuned by the platform for everyone, and it is tuned
 * conservatively on purpose, because a false positive silences a legitimate
 * hello. This is where a traveler says in advance what they would rather not
 * read, and it does exactly one thing: a first message using one of these
 * words arrives folded up with a tap to open it.
 *
 * WHY IT IS NOT ON /visibility. That screen's own header commits out loud to
 * three promises, and one of them is that it does nothing to chat. Hanging a
 * message filter off it would break the one thing it says about itself, on
 * the screen where somebody is deciding whether to trust the app with
 * anything at all.
 *
 * WHAT THIS SCREEN MUST NEVER BECOME: a block list, a report, or anything
 * with a consequence for the sender. Nothing here reaches the other person.
 * Hard rule 5 is untouched either way — every first message is classified
 * before it is delivered, and this layer runs afterwards, on this phone.
 */
export default function MutedWordsScreen() {
  const theme = useTheme();
  // The whole query, not its rows: destructuring the data away is what once
  // told somebody with six archived conversations, offline, that they had
  // none. A list of your own words is the same shape of wrong answer.
  const query = useMutedWords();
  const words = query.data ?? [];
  const save = useSetMutedWords();

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const full = words.length >= MUTED_WORDS_MAX;
  // The field is capped at MUTED_WORD_MAX characters, so iOS simply stops
  // accepting keystrokes at the ceiling and says nothing about it. There used
  // to be a "keep it to 40 characters" error here for that, which maxLength
  // made unreachable: the branch could not run and the behaviour it described
  // happened in silence. The hint says it at the moment it bites instead.
  const atCap = draft.length >= MUTED_WORD_MAX;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile-me'));

  const add = () => {
    const word = normalizeMutedWord(draft);
    if (word == null) {
      setError('Type a word first.');
      return;
    }
    if (words.includes(word)) {
      setError('That one is already on your list.');
      return;
    }
    if (full) {
      setError('That is as many as one list holds. Take one off to add another.');
      return;
    }
    haptics.selection();
    setDraft('');
    setError(null);
    // The list BEFORE this edit, handed over rather than looked up. The
    // mutation used to read it back out of the query cache, which onMutate
    // has already overwritten with the optimistic value by then, so the diff
    // was always empty and nothing was ever written to the table.
    save.mutate({ previous: words, next: [...words, word] });
  };

  const remove = (word: string) => {
    haptics.selection();
    setError(null);
    save.mutate({ previous: words, next: words.filter((entry) => entry !== word) });
  };

  return (
    <StepScreen
      title="Words you would rather not see"
      // What it does, where it stops, and the things people assume it does
      // and it does not. The fold is on the way IN and nowhere else: an
      // opened hello, and an accepted one in its chat, are plain from then
      // on, so the sentence says so rather than letting somebody find out.
      subtitle="A first message using one of these arrives folded up, with a tap to open it. The fold is only on the way in: open it or accept, and the words stay open after that. Nothing is deleted, nobody is blocked, and the person who wrote it is never told. Only you can see this list."
      continueLabel="Done"
      onContinue={close}
      // A visible way out, the shape contact and guest-name use. Without it
      // the only exit from a modal is a swipe down, which is a gesture
      // nothing on the screen mentions.
      onClose={close}>
      <View style={styles.adder}>
        <FormTextField
          label="Add a word"
          testID="muted-word-input"
          placeholder="A word, or a short phrase"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          maxLength={MUTED_WORD_MAX}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            setError(null);
          }}
          onSubmitEditing={add}
          error={error}
          // Both halves of what the matcher really does. "Matched whole" on
          // its own is true in Latin, Greek and Cyrillic and the opposite of
          // what happens in every script with no capital letters, where the
          // matcher falls through to a plain substring - and this is an app
          // for people travelling through those places. A control says
          // exactly what happens.
          hint={
            atCap
              ? 'That is as long as one entry gets.'
              : 'Matched as a whole word. In scripts without capital letters, like Arabic, Thai or Japanese, it also matches inside a longer word.'
          }
        />
        {/* Ghost, and disabled by COLOUR rather than by fading: primary-button
            swaps the label for textSecondary instead of dropping alpha, which
            is the one way to say unavailable and stay legible. */}
        <PrimaryButton
          variant="ghost"
          label="Add"
          disabled={draft.trim().length === 0 || save.isPending}
          onPress={add}
        />
      </View>

      {query.isPending ? (
        <>
          <Skeleton height={52} radius={Radius.md} />
          <Skeleton height={52} radius={Radius.md} />
        </>
      ) : null}
      {query.isError ? (
        <LoadError compact what="your list" error={query.error} onRetry={query.refetch} />
      ) : null}

      {words.length > 0 ? (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {countOf(words.length, 'word')}
          </ThemedText>
          <View style={[styles.card, { backgroundColor: theme.surface }]}>
            {words.map((word, index) => (
              <View
                key={word}
                style={[
                  styles.row,
                  index === 0
                    ? null
                    : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline },
                ]}>
                <ThemedText style={styles.flex} numberOfLines={1}>
                  {word}
                </ThemedText>
                {/* Not danger red. Taking a word off your own list is not a
                    destructive act, and red is reserved for the ones that
                    are. */}
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Take ${word} off your list`}
                  haptic="light"
                  scaleTo={0.94}
                  hitSlop={10}
                  onPress={() => remove(word)}
                  style={[styles.action, { backgroundColor: theme.surfaceSunken }]}>
                  <ThemedText type="footnote" themeColor="accent">
                    Take off
                  </ThemedText>
                </PressableScale>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {/* Only on success-with-zero: a failed fetch is not an empty list. */}
      {query.isSuccess && words.length === 0 ? (
        <EmptyState
          title="Nothing on your list"
          body="Add a word and a first message that uses it will arrive folded up, for you to open or not."
        />
      ) : null}

      {/* The line this screen does not draw. Somebody setting their own rule
          should know the app already has one, or the absence of a word here
          reads as the absence of any screening at all. */}
      <ThemedText type="footnote" themeColor="textSecondary">
        Every first message is checked before it reaches you, whatever is on this list. This is your
        own line on top of that.
      </ThemedText>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  adder: {
    gap: Space.sm,
  },
  card: {
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 52,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  flex: {
    flex: 1,
  },
  action: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
  },
});
