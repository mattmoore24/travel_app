import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Image } from 'expo-image';
import { useNextTravelersPrefetch, type PrefetchTarget } from '@/features/matching/prefetch';

jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn().mockResolvedValue(true) } }));
jest.mock('@/features/profile/api', () => ({
  fetchPublicProfile: jest.fn(),
  fetchPhotos: jest.fn(),
  signedPhotoUrl: jest.fn(),
}));

/**
 * Two cards ahead, and no further.
 *
 * The loop the whole product runs on is read a person, tap Next, read the
 * next person - and every Next used to start the chain from nothing: profile,
 * photos, a signed URL, then the image. The first thing anybody saw of a
 * traveler was an empty frame where their face goes.
 *
 * The ceiling matters as much as the fetch. Prefetching the whole queue would
 * mint a signed URL for every traveler in the city and fill the image cache
 * with faces nobody looked at.
 */
const queue: PrefetchTarget[] = [
  { userId: 'on-screen', photoPath: 'on-screen/0.jpg' },
  { userId: 'next', photoPath: 'next/0.jpg' },
  { userId: 'after-that', photoPath: 'after/0.jpg' },
  { userId: 'too-far', photoPath: 'far/0.jpg' },
];

function run(input = queue) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const spy = jest.spyOn(client, 'prefetchQuery').mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useNextTravelersPrefetch(input), { wrapper });
  return { client, spy, hook };
}

describe('the next traveler is already downloaded', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks for exactly three keys each, for the next two and nobody else', () => {
    const { spy } = run();
    expect(spy.mock.calls.map((call) => call[0].queryKey)).toEqual([
      ['public-profile', 'next'],
      ['public-photos', 'next'],
      ['photo-url', 'next/0.jpg'],
      ['public-profile', 'after-that'],
      ['public-photos', 'after-that'],
      ['photo-url', 'after/0.jpg'],
    ]);
  });

  it('never asks for the card already on screen', () => {
    const { spy } = run();
    const keys = JSON.stringify(spy.mock.calls.map((call) => call[0].queryKey));
    expect(keys).not.toContain('on-screen');
    expect(keys).not.toContain('too-far');
  });

  it('skips the signed URL for a traveler with no photo', () => {
    const { spy } = run([queue[0]!, { userId: 'faceless', photoPath: null }]);
    expect(spy.mock.calls.map((call) => call[0].queryKey)).toEqual([
      ['public-profile', 'faceless'],
      ['public-photos', 'faceless'],
    ]);
  });

  it('downloads the image once the signed URL is in the cache', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    jest.spyOn(client, 'prefetchQuery').mockImplementation(async (options) => {
      const key = options.queryKey as [string, string];
      if (key[0] === 'photo-url') {
        client.setQueryData(key, `https://signed.example/${key[1]}`);
      }
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useNextTravelersPrefetch(queue.slice(0, 2)), { wrapper });
    await waitFor(() =>
      expect(Image.prefetch).toHaveBeenCalledWith('https://signed.example/next/0.jpg')
    );
  });

  it('does not re-ask when the render changes but the two ahead do not', () => {
    const { spy, hook } = run();
    const first = spy.mock.calls.length;
    hook.rerender(undefined);
    expect(spy.mock.calls.length).toBe(first);
  });
});
