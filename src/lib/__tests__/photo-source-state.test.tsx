import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useBusinessPhotoSourceState } from '@/features/business/photo-url';
import { useChatPhotoSourceState } from '@/features/chat/hooks';
import { usePhotoSourceState } from '@/features/profile/hooks';
import type { PhotoSourceState } from '@/lib/photo-source';

/**
 * The three photo families (profile, business, chat) each sign against
 * their own bucket and each hand a frame the same two things: the source
 * with its cache key, and whether the null it holds is temporary. One test
 * per family, through a real QueryClient, because the derivation is a pure
 * function already pinned in photo-source.test.ts and what is left to prove
 * is the wiring: that each hook reads ITS query and not a stale one.
 */

const mockSign = jest.fn();

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    storage: {
      from: () => ({ createSignedUrl: (...args: unknown[]) => mockSign(...args) }),
    },
  },
}));

// The chat hooks pull the analytics client in on import, and without a key
// it warns on every run. Nothing here captures.
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));

const PATH = 'u1/abc.jpg';
const URL = 'https://x.supabase.co/sign/u1/abc.jpg?token=1';

// One client per test, CLEARED after it. The hooks under test hold their
// answer for fifty-five minutes (gcTime), which is a fifty-five minute timer
// on the query cache; left in place it keeps the jest process alive after
// the last assertion whenever this file runs in-band, which it does on its
// own. clear() destroys the queries and their timers with them.
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const FAMILIES: [string, (path: string | null) => PhotoSourceState][] = [
  ['profile', usePhotoSourceState],
  ['business', useBusinessPhotoSourceState],
  ['chat', useChatPhotoSourceState],
];

describe.each(FAMILIES)('%s photos', (_family, useState) => {
  it('is pending until the URL is signed, then carries the path as the cache key', async () => {
    let resolve: (value: unknown) => void = () => {};
    mockSign.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    const { result } = renderHook(() => useState(PATH), { wrapper });
    expect(result.current).toEqual({ source: null, pending: true });

    await act(async () => {
      resolve({ data: { signedUrl: URL }, error: null });
    });
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.source).toEqual({ uri: URL, cacheKey: PATH });
  });

  it('is settled at once with no path, which is the no-photo case', () => {
    const { result } = renderHook(() => useState(null), { wrapper });
    expect(result.current).toEqual({ source: null, pending: false });
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('stops pending when the signing fails', async () => {
    mockSign.mockResolvedValueOnce({ data: null, error: new Error('nope') });
    const { result } = renderHook(() => useState(PATH), { wrapper });
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.source).toBeNull();
  });
});
