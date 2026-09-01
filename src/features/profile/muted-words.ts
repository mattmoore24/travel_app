import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useOwnUserId } from '@/features/profile/hooks';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Words a traveler would rather not see, and the matcher that decides what
 * counts as seeing one.
 *
 * THIS SITS ON TOP OF THE SERVER PIPELINE AND NEVER REPLACES IT. Hard rule 5
 * is untouched: every first message is still classified by the moderation
 * worker before it is delivered, and nothing in this file is consulted on
 * that path. What lives here runs at RENDER, on the recipient's own device,
 * after delivery. It folds a hello behind a tap. It deletes nothing, blocks
 * nobody, changes no verdict, and the sender is never told any of it exists.
 *
 * The hazard the whole feature turns on is the matcher, and it is worth being
 * blunt about it: a naive `includes()` folds "assist" for "ass" and "classic"
 * for "ass", and an app that hides innocent sentences and will not say why
 * reads as censorship rather than protection, which is worse than the problem
 * it solves. So the match is on WORD BOUNDARIES wherever this can see one (see
 * isWordChar), and the fold names the word that caused it — to the reader, on
 * the reader's own screen, never to the sender. The screen's own hint says
 * both halves of that out loud, because a control says exactly what happens.
 */

/** The longest a single entry may be, matching the column's own check. */
export const MUTED_WORD_MAX = 40;

/** A practical ceiling on the list, so the editor has something to say. */
export const MUTED_WORDS_MAX = 50;

/**
 * One entry, folded into the one shape the database will accept: lower case,
 * trimmed, single-spaced. Returns null for anything that is not a word at all,
 * so the caller can refuse it rather than write a row that fails a check
 * constraint.
 *
 * The folding is not cosmetic. `user_muted_words` is keyed on (user_id, word),
 * and that key is what stops 'Ass', 'ass ' and 'ass' becoming three rows that
 * all do the same thing on a list that then looks broken.
 */
export function normalizeMutedWord(raw: string): string | null {
  const folded = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (folded.length === 0 || folded.length > MUTED_WORD_MAX) {
    return null;
  }
  return folded;
}

/** A list folded, deduped and ordered the way the screen shows it. */
export function normalizeMutedWords(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const entry of raw) {
    const word = normalizeMutedWord(entry);
    if (word != null) {
      seen.add(word);
    }
  }
  return [...seen].sort();
}

/**
 * Is this character part of a word?
 *
 * Deliberately not `\b` and deliberately not a `\p{L}` class. `\b` is
 * ASCII-only, so it would treat every accented letter as a boundary and fold
 * "Straße" for "stra". Unicode property escapes would be right on Node and
 * are a bet on the engine in the app.
 *
 * What is here instead is a property every bicameral script has and no other
 * character does: a letter that has a case differs from itself when you
 * change it. Latin, Greek and Cyrillic letters answer true and get real
 * boundaries. Chinese, Japanese, Korean and Thai answer false — and that is
 * the right answer for them rather than a gap, because those scripts do not
 * put spaces between words, so a boundary rule would mean a muted word in
 * them could never match at all. They fall through to a plain substring
 * match, which is what a reader of those languages would expect. The cost is
 * that unicameral scripts which DO use spaces (Arabic, Hebrew, Devanagari)
 * match on substrings too, so a short entry in one of them can fold more than
 * it meant to.
 */
function isWordChar(ch: string): boolean {
  if (ch >= '0' && ch <= '9') {
    return true;
  }
  if (ch === '_') {
    return true;
  }
  return ch.toLowerCase() !== ch.toUpperCase();
}

/**
 * The first word on the list this text uses, or null.
 *
 * Case-insensitive, matched on word boundaries in every script that HAS
 * boundaries this can see (isWordChar above: a cased script), and on a plain
 * substring in the ones that do not. It returns WHICH word matched rather than
 * a boolean, because the fold has to be able to say what caused it. That
 * sentence is only ever shown to the person whose list it is.
 */
export function matchesMutedWord(text: string, words: readonly string[]): string | null {
  const haystack = text.toLowerCase();
  if (haystack.length === 0) {
    return null;
  }
  for (const raw of words) {
    const needle = normalizeMutedWord(raw);
    if (needle == null) {
      continue;
    }
    // Boundaries are required only on the ends that are word-shaped. An entry
    // like "18+" ends in a character that is not part of a word, so nothing
    // after it should have to be a space.
    const openEnd = isWordChar(needle[0]!);
    const closeEnd = isWordChar(needle[needle.length - 1]!);
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) {
        break;
      }
      const before = at === 0 ? null : haystack[at - 1]!;
      const afterAt = at + needle.length;
      const after = afterAt >= haystack.length ? null : haystack[afterAt]!;
      const startsClean = !openEnd || before == null || !isWordChar(before);
      const endsClean = !closeEnd || after == null || !isWordChar(after);
      if (startsClean && endsClean) {
        return needle;
      }
      from = at + 1;
    }
  }
  return null;
}

const mutedWordsKey = (userId: string | null) => ['muted-words', userId];

/**
 * The reader's own list.
 *
 * `.eq('user_id', ...)` is belt and braces: RLS already answers with nothing
 * else. It is there so the query is an index seek rather than a scan the
 * policy then filters, and so the intent is legible from the call site.
 */
export function useMutedWords() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: mutedWordsKey(userId),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('user_muted_words')
        .select('word')
        .eq('user_id', userId!)
        .order('word');
      if (error) {
        throw error;
      }
      return (data ?? []).map((row) => row.word);
    },
    enabled: isSupabaseConfigured && userId != null,
    // Read on every incoming hello. A minute of staleness is nothing next to
    // a round trip per card in a list.
    staleTime: 60_000,
  });
}

/**
 * One edit: the list as it stands, and the list it should become.
 *
 * `previous` is an ARGUMENT and not a read of the query cache, and that is the
 * entire reason this type exists. `onMutate` writes the optimistic list into
 * the cache BEFORE `mutationFn` runs, so a `mutationFn` that asked the cache
 * what the list used to be was handed the value it was about to write: `gone`
 * and `added` both came out empty and neither the insert nor the delete was
 * ever sent. Nothing on screen showed it, because the optimistic write plus
 * `onSuccess` held the list correct for the rest of the session and only a
 * cold start disagreed. A safety setting that reports success and stores
 * nothing is worse than one that is not there.
 */
export type MutedWordsEdit = {
  /** The list before this edit, from the caller that is showing it. */
  previous: readonly string[];
  /** The list after it. */
  next: readonly string[];
};

/**
 * Replace the list.
 *
 * A diff rather than a delete-then-insert, for one reason that matters: a
 * delete-all that succeeds and an insert that then fails leaves somebody with
 * an empty list they did not empty, and no way to know it happened. The worst
 * this can do is fail to add or fail to remove one word.
 */
export function useSetMutedWords() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ previous, next }: MutedWordsEdit): Promise<string[]> => {
      const wanted = normalizeMutedWords(next);
      const before = normalizeMutedWords(previous);
      const gone = before.filter((word) => !wanted.includes(word));
      const added = wanted.filter((word) => !before.includes(word));
      if (gone.length > 0) {
        const { error } = await supabase
          .from('user_muted_words')
          .delete()
          .eq('user_id', userId!)
          .in('word', gone);
        if (error) {
          throw error;
        }
      }
      if (added.length > 0) {
        const { error } = await supabase
          .from('user_muted_words')
          .insert(added.map((word) => ({ user_id: userId!, word })));
        if (error) {
          throw error;
        }
      }
      return wanted;
    },
    // Optimistic, because a chip that appears a round trip after you typed it
    // reads as a field that swallowed what you wrote.
    onMutate: async ({ next }) => {
      await queryClient.cancelQueries({ queryKey: mutedWordsKey(userId) });
      const rollback = queryClient.getQueryData<string[]>(mutedWordsKey(userId));
      queryClient.setQueryData(mutedWordsKey(userId), normalizeMutedWords(next));
      return { rollback };
    },
    onError: (_error, _edit, context) => {
      if (context?.rollback !== undefined) {
        queryClient.setQueryData(mutedWordsKey(userId), context.rollback);
      }
    },
    onSuccess: (wanted) => {
      queryClient.setQueryData(mutedWordsKey(userId), wanted);
    },
    // And then go and ask. The optimistic write is what makes a chip appear
    // instantly; it is also what let a mutation that sent nothing at all look
    // exactly like one that worked, for a whole session. One round trip after
    // every edit means the screen agrees with the table within a second of
    // the edit rather than at the next cold start, whatever went wrong in
    // between - a half-applied diff included.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: mutedWordsKey(userId) });
    },
  });
}
