import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useSetMutedWords } from '@/features/profile/muted-words';

/**
 * The list has to reach the TABLE, and only a test that watches the client
 * calls can say whether it did.
 *
 * This is the exact failure that shipped: `mutationFn` worked out its diff by
 * reading the previous list back out of the query cache, and `onMutate` had
 * already overwritten that cache with the optimistic value by the time it ran.
 * So `gone` and `added` were empty on every edit and neither the insert nor
 * the delete was ever sent. Nothing on the screen disagreed - the optimistic
 * write plus `onSuccess` held the list correct for the whole session, and the
 * row was simply absent at the next cold start. A safety setting that reports
 * success and stores nothing is worse than one that is not there.
 *
 * So the assertions below are about the STATEMENTS that leave the device, not
 * about how the cache looks afterwards. A test that asserted the cache would
 * have passed against the broken version.
 */

type Sent = { verb: 'delete'; userId: unknown; words: unknown } | { verb: 'insert'; rows: unknown };

// jest.mock factories are hoisted above every other binding, so the state they
// close over has to be named mock* to be allowed through.
const mockSent: Sent[] = [];

jest.mock('@/features/profile/hooks', () => ({ useOwnUserId: () => 'me' }));

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => {
      if (table !== 'user_muted_words') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        delete: () => ({
          eq: (_column: string, userId: unknown) => ({
            in: (_wordColumn: string, words: unknown) => {
              mockSent.push({ verb: 'delete', userId, words });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
        insert: (rows: unknown) => {
          mockSent.push({ verb: 'insert', rows });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  },
}));

// gcTime 0 so the client holds no timers past the test; the leak otherwise
// keeps the jest worker alive after the suite is done.
const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });

const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

/** Run one edit through the real hook and hand back what the client sent. */
const edit = async (
  previous: readonly string[],
  next: readonly string[],
  prime?: readonly string[]
): Promise<Sent[]> => {
  const client = newClient();
  // The cache as the screen would have left it, so the mutation has something
  // wrong to read if it ever goes back to reading it.
  if (prime) {
    client.setQueryData(['muted-words', 'me'], [...prime]);
  }
  const hook = renderHook(() => useSetMutedWords(), { wrapper: wrapperFor(client) });
  await act(async () => {
    await hook.result.current.mutateAsync({ previous, next });
  });
  hook.unmount();
  client.clear();
  return mockSent;
};

beforeEach(() => {
  mockSent.length = 0;
});

describe('adding a word', () => {
  it('inserts the row, under the reader’s own id', async () => {
    expect(await edit([], ['hook up'])).toEqual([
      { verb: 'insert', rows: [{ user_id: 'me', word: 'hook up' }] },
    ]);
  });

  it('still inserts it when the cache already holds the optimistic answer', async () => {
    // The regression, named. `prime` is what onMutate writes a moment before
    // mutationFn runs: a mutation that works out `added` from the cache sees
    // the word already there, concludes there is nothing to add, and sends
    // nothing at all while the screen goes on showing it.
    const sent = await edit(['ass'], ['ass', 'party'], ['ass', 'party']);
    expect(sent).toEqual([{ verb: 'insert', rows: [{ user_id: 'me', word: 'party' }] }]);
  });

  it('folds what it writes, so the row cannot fail the column’s own check', async () => {
    expect(await edit([], ['  Hook   Up  '])).toEqual([
      { verb: 'insert', rows: [{ user_id: 'me', word: 'hook up' }] },
    ]);
  });
});

describe('taking one off', () => {
  it('deletes exactly the word that went, and only for this account', async () => {
    expect(await edit(['ass', 'hook up'], ['hook up'])).toEqual([
      { verb: 'delete', userId: 'me', words: ['ass'] },
    ]);
  });

  it('still deletes it when the cache already holds the shortened list', async () => {
    const sent = await edit(['ass', 'hook up'], ['hook up'], ['hook up']);
    expect(sent).toEqual([{ verb: 'delete', userId: 'me', words: ['ass'] }]);
  });
});

describe('one edit that both adds and removes', () => {
  it('sends the delete first, so a full list can be swapped without tripping the key', async () => {
    expect(await edit(['ass'], ['party'])).toEqual([
      { verb: 'delete', userId: 'me', words: ['ass'] },
      { verb: 'insert', rows: [{ user_id: 'me', word: 'party' }] },
    ]);
  });

  it('sends nothing at all when nothing changed', async () => {
    expect(await edit(['ass'], ['ass'])).toEqual([]);
  });
});
