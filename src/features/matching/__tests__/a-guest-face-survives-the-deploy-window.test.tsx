import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { featuredPhotoFor, useFeaturedPhoto } from '@/features/guest/hooks';
import type { FeaturedTravelerRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

/**
 * A guest keeps a face through the window where the app and the edge function
 * disagree, and never wears somebody else's.
 *
 * `featured-photo` is deployed by .github/workflows/supabase-deploy.yml,
 * which runs `supabase db push` and then `supabase functions deploy` as two
 * steps of one job - so the function and its migrations land together, and the
 * window is not between them. It is between the SERVER and this bundle, which
 * ships over the air on a different workflow, so whichever of the two goes
 * first the other is older for a while. An update is also never applied on the
 * launch that downloads it, which widens that window by at least one launch on
 * every phone. Reading only the newest shape would take the guest's face away
 * for the whole of it - the exact regression the function was written to fix.
 *
 * The other half is the reason the newest shape exists at all. The URLs used
 * to arrive as a bare list and the screen indexed it against the cards, which
 * is only sound while both calls to featured_traveler() see the same people:
 * they are two evaluations, seconds apart, of a function whose guards are per
 * PERSON, so somebody banned, blocked, out of audience or out of trip drops
 * from one row set and not the other and every face after them moves up a
 * name. Keyed by user_id that is a monogram instead.
 *
 * (Filed under features/matching/__tests__ because that is this implementer's
 * test directory this session; it is about src/features/guest/hooks.ts.)
 */

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: jest.fn() } },
}));

const invoke = supabase.functions.invoke as jest.Mock;

const traveler = (user_id: string): FeaturedTravelerRow => ({
  user_id,
  display_name: user_id.toUpperCase(),
  age: 30,
  verified: false,
  bio: null,
  city_name: 'Lisbon',
  their_start: '2026-09-03',
  their_end: '2026-09-09',
  photo_path: `${user_id}/0.jpg`,
  approximate: false,
});

const ON_SCREEN = [traveler('u1'), traveler('u2'), traveler('u3')];

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

/** The hook's answer for a payload, with three travelers on screen. */
const photosFor = async (payload: unknown, featured = ON_SCREEN) => {
  invoke.mockResolvedValue({ data: payload, error: null });
  const client = newClient();
  const hook = renderHook(() => useFeaturedPhoto(1, featured), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  const photos = hook.result.current.data;
  hook.unmount();
  client.clear();
  return photos;
};

/** What each of the three travelers on screen would actually be drawn with. */
const facesFor = async (payload: unknown) => {
  const photos = await photosFor(payload);
  return ON_SCREEN.map((row, index) => featuredPhotoFor(photos, row.user_id, index));
};

describe('the featured faces', () => {
  it('reads the function that only ever signed the lead', async () => {
    expect(await facesFor({ url: 'https://example.test/one.jpg' })).toEqual([
      'https://example.test/one.jpg',
      null,
      null,
    ]);
  });

  it('never draws a face off its place in a list, because no shape sends one', async () => {
    // There were three shapes here for a while, and the middle one was a bare
    // positional list justified as what an older bundle reads. No bundle ever
    // read it: HEAD's hook reads `data?.url` alone and the shipped function
    // returned `{ url }` alone. A positional list is also the exact shape that
    // put one traveler's face under another traveler's name, so a server that
    // sent one would be a server this client must not trust by index.
    expect(
      await facesFor({
        urls: ['https://example.test/one.jpg', null, 'https://example.test/three.jpg'],
      } as Record<string, unknown>)
    ).toEqual([null, null, null]);
  });

  it('reads a face off the identity that came with it, not off its place in the list', async () => {
    // The order is deliberately not the screen's. Positionally this would put
    // u3's face on u1's card.
    expect(
      await facesFor({
        photos: [
          { user_id: 'u3', url: 'https://example.test/three.jpg' },
          { user_id: 'u1', url: 'https://example.test/one.jpg' },
          { user_id: 'u2', url: 'https://example.test/two.jpg' },
        ],
      })
    ).toEqual([
      'https://example.test/one.jpg',
      'https://example.test/two.jpg',
      'https://example.test/three.jpg',
    ]);
  });

  it('gives a traveler no face at all when the two calls disagreed about who is featured', async () => {
    // u2 was banned, blocked, narrowed their audience or reached the end of
    // their trip between the two calls, so the service role signed somebody
    // the screen is not showing. Nobody wears that face.
    expect(
      await facesFor({
        photos: [
          { user_id: 'u1', url: 'https://example.test/one.jpg' },
          { user_id: 'u9', url: 'https://example.test/stranger.jpg' },
          { user_id: 'u3', url: 'https://example.test/three.jpg' },
        ],
      })
    ).toEqual(['https://example.test/one.jpg', null, 'https://example.test/three.jpg']);
  });

  it('never falls back to a position once identities are on offer', async () => {
    // One entry, for somebody else. The old positional read would have drawn
    // it on the lead card.
    expect(
      await facesFor({ photos: [{ user_id: 'u9', url: 'https://example.test/x.jpg' }] })
    ).toEqual([null, null, null]);
  });

  it('treats nobody with a face as an ordinary empty answer', async () => {
    // Not an error: the monogram is the designed failure path, and a thrown
    // query here would take the whole card down with it.
    expect(await facesFor({ url: null })).toEqual([null, null, null]);
    expect(await facesFor({ photos: [] })).toEqual([null, null, null]);
  });

  it('asks for a city and never for a person or a path', async () => {
    // The whole privacy argument for signing a private bucket's object at all
    // is that the caller cannot name what gets signed.
    await photosFor({ url: null });
    expect(invoke).toHaveBeenCalledWith('featured-photo', { body: { city_id: 1 } });
  });

  it('does not ask at all when nobody on screen has a photo', async () => {
    invoke.mockClear();
    invoke.mockResolvedValue({ data: { photos: [] }, error: null });
    const client = newClient();
    const hook = renderHook(() => useFeaturedPhoto(1, [{ ...traveler('u1'), photo_path: null }]), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));
    expect(invoke).not.toHaveBeenCalled();
    hook.unmount();
    client.clear();
  });

  it('fetches again when the travelers on screen change', async () => {
    // The two lists run on two clocks: the ranking is live and refetches on
    // the global 30s staleTime, while these URLs are pinned for four minutes.
    // Keyed on the city alone, a refreshed list was drawn against faces minted
    // for the people who used to be in it.
    invoke.mockClear();
    invoke.mockResolvedValue({ data: { photos: [] }, error: null });
    const client = newClient();
    const hook = renderHook(
      ({ rows }: { rows: FeaturedTravelerRow[] }) => useFeaturedPhoto(1, rows),
      {
        wrapper: wrapperFor(client),
        initialProps: { rows: ON_SCREEN },
      }
    );
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(1);
    hook.rerender({ rows: [traveler('u4'), traveler('u5'), traveler('u6')] });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    hook.unmount();
    client.clear();
  });
});
