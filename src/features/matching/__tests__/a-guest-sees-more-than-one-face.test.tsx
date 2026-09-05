import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Image } from 'expo-image';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import TravelersScreen from '@/app/(tabs)/travelers';
import { supabase } from '@/lib/supabase';

/**
 * A signed-out visitor is shown three travelers, and can reach the sign-up
 * card from any of them.
 *
 * The tab's whole job on launch day is answering "are there people here on my
 * dates", and one face cannot answer it - dead cities are this category's
 * number one killer.
 *
 * THIS FILE USED TO HAND THE SCREEN ITS ANSWER. It mocked useFeaturedTraveler
 * to return three travelers, so it was green over a server whose function
 * ended in `limit 1`: a screen built for three, a database that had never
 * returned more than one, and a suite that proved the mock. That is exactly
 * the "a test that mocks Supabase proves the mock works" case, and this
 * project has now paid for it more than once in a week.
 *
 * So nothing between the transport and the pixels is mocked here. The RPC
 * payload is the only thing supplied, useFeaturedTraveler and useFeaturedPhoto
 * are the real hooks, and the assertions are about what a person sees. What
 * the DATABASE returns for that RPC is a database question and is proved
 * against a real cluster in supabase/tests/database/10_rooms_guest_mode.test.sql
 * (three rows, one per traveler, and every exclusion checked over the whole
 * result rather than over its first row). The last describe here holds the two
 * server-side files to the count, so the chain has no unproved link left in
 * it.
 *
 * The other half is the rule the extra faces must not break: more faces is
 * not more data per face. The lead keeps the bio; the rows carry a face, a
 * name and the dates, and this asserts the bios are not there. The fixture
 * hands the screen three bios even though 20260902260000 now sends only the
 * lead's, because the two halves are worth proving separately: the server not
 * sending them is pgTAP's, the screen not printing them is this file's.
 *
 * And the faces are keyed BY TRAVELER. The card list and the photo list are
 * two separate calls to featured_traveler(), whose guards run per person, so
 * indexing one against the other draws a real traveler's face under another
 * real traveler's name the moment the two row sets differ by one.
 *
 * (Filed under features/matching/__tests__ because that is this
 * implementer's test directory this session; it is about the guest branch of
 * src/app/(tabs)/travelers.tsx.)
 */

jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));

const TRAVELERS = [
  {
    user_id: 'u1',
    display_name: 'Ana',
    age: 29,
    verified: true,
    bio: 'Here for the food and the tiles.',
    city_name: 'Lisbon',
    their_start: '2026-09-01',
    their_end: '2026-09-10',
    photo_path: 'u1/0.jpg',
    approximate: false,
  },
  {
    user_id: 'u2',
    display_name: 'Bea',
    age: 31,
    verified: false,
    bio: 'Cycling the coast for a fortnight.',
    city_name: 'Lisbon',
    their_start: '2026-09-03',
    their_end: '2026-09-12',
    photo_path: 'u2/0.jpg',
    approximate: false,
  },
  {
    user_id: 'u3',
    display_name: 'Cai',
    age: 26,
    verified: false,
    bio: 'Looking for a running partner.',
    city_name: 'Lisbon',
    their_start: '2026-09-05',
    their_end: '2026-09-09',
    photo_path: null,
    approximate: false,
  },
];

// The transport, and nothing above it. `featured_traveler` is the RPC the real
// useFeaturedTraveler calls; `public_city_pins` is the guest map feed the same
// screen reads for its empty-city line.
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } },
}));

jest.mock('@/features/business/hooks', () => ({
  useIsBusiness: () => false,
  useListingIntent: () => ({ data: false }),
  useOwnBusiness: () => ({ data: null }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

jest.mock('@/features/pins/hooks', () => ({
  // The rail, which is what a guest's Travelers tab reads its city off.
  useFeaturedCities: () => ({
    data: [{ city_id: 1, cities: { name: 'Lisbon' } }],
    isError: false,
    isPending: false,
  }),
}));

jest.mock('@/features/matching/hooks', () => ({
  useMatches: () => ({ data: [], isError: false, refetch: jest.fn() }),
  useSetTravelersRadius: () => ({ set: jest.fn(), isPending: false }),
  useMyChats: () => ({ data: [] }),
  useSentRequests: () => ({ data: [] }),
  useJustSentHello: Object.assign(() => null, { getState: () => ({ clear: jest.fn() }) }),
  useDailySpotlight: () => ({ data: null }),
  useFirstMessageBudget: () => ({ data: { used: 0, allowed: 8 } }),
}));

jest.mock('@/features/trips/hooks', () => ({
  useMyTrips: () => ({ data: [], isError: false, refetch: jest.fn() }),
  useTravelerTrips: () => ({ data: [] }),
}));

jest.mock('@/features/profile/hooks', () => ({
  useOwnProfile: () => ({ data: null }),
  // The trip picker's store is keyed on the account; a guest has none.
  useOwnUserId: () => null,
  useOwnVisibility: () => ({ data: 'everyone' }),
  usePublicProfile: () => ({ data: null }),
  usePublicPhotos: () => ({ data: [] }),
  useProfilePrompts: () => ({ data: [] }),
  useProfilePriorities: () => ({ data: [] }),
}));

jest.mock('@/features/matching/prefetch', () => ({ useNextTravelersPrefetch: () => {} }));
jest.mock('@/features/chat/hooks', () => ({ useBlockUser: () => ({ mutate: jest.fn() }) }));
jest.mock('@/components/ui/avatar-button', () => ({ AvatarButton: () => null }));

// Kept real enough to be findable: the point of the third card is that the
// gate is still under it.
jest.mock('@/components/ui/sign-up-gate', () => {
  const { Text } = jest.requireActual('react-native');
  return { SignUpGate: ({ reason }: { reason: string }) => <Text>{reason}</Text> };
});

const rpc = supabase.rpc as jest.Mock;
const invoke = supabase.functions.invoke as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </SafeAreaProvider>
    );
  };

const show = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(<TravelersScreen />, { wrapper: wrapperFor(client) });
  return { view, client };
};

beforeEach(() => {
  rpc.mockImplementation((name: string) =>
    Promise.resolve({
      data: name === 'featured_traveler' ? TRAVELERS : [],
      error: null,
    })
  );
  // Only the lead is signed while the edge function still mints one URL, so
  // this is what the screen actually gets on the day the migration lands
  // ahead of the function deploy.
  invoke.mockResolvedValue({ data: { url: 'https://example.test/u1.jpg' }, error: null });
});

describe('a guest on the Travelers tab', () => {
  it('is shown all three travelers the server returned, not just the first', async () => {
    const { view, client } = show();
    expect(await screen.findByText('Ana, 29')).toBeTruthy();
    expect(screen.getByText('Bea, 31')).toBeTruthy();
    expect(screen.getByText('Cai, 26')).toBeTruthy();
    // The city, once, and the RPC that carries no viewer and no person.
    expect(rpc).toHaveBeenCalledWith('featured_traveler', { p_city_id: 1 });
    view.unmount();
    client.clear();
  });

  it("shows only what the server sent, so the count is never the client's", async () => {
    // The screen is not built for three, it is built for however many arrive.
    // A hardcoded three here would be the bug this file used to have.
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === 'featured_traveler' ? TRAVELERS.slice(0, 2) : [],
        error: null,
      })
    );
    const { view, client } = show();
    expect(await screen.findByText('Ana, 29')).toBeTruthy();
    expect(screen.getByText('Bea, 31')).toBeTruthy();
    expect(screen.queryByText('Cai, 26')).toBeNull();
    view.unmount();
    client.clear();
  });

  it('can reach the sign-up card from any of them', async () => {
    const { view, client } = show();
    // The tap scrolls to the gate rather than pushing a profile route no
    // signed-out device can read, so the label is the SCROLL, said out loud.
    // It used to read "Say hi to Ana" - the one action the tap cannot take,
    // and the same sentence the visible line on the lead card was rewritten
    // away from, left on the part only VoiceOver reads.
    expect(await screen.findByLabelText('Ana. Make a profile to see theirs')).toBeTruthy();
    expect(screen.getByLabelText('Bea. Make a profile to see theirs')).toBeTruthy();
    expect(screen.getByLabelText('Cai. Make a profile to see theirs')).toBeTruthy();
    expect(screen.queryByLabelText('Say hi to Ana')).toBeNull();
    // And the card itself is still on the screen under them.
    expect(screen.getByText('Make a profile to say hi to Ana')).toBeTruthy();
    view.unmount();
    client.clear();
  });

  it('does not hand over more of each traveler than it did before', async () => {
    const { view, client } = show();
    // The lead's bio is the pitch. The other two are a face, a name and
    // dates: three faces was the change, three bios would be three times as
    // much of three real travelers handed to a device with no account.
    expect(await screen.findByText('Here for the food and the tiles.')).toBeTruthy();
    expect(screen.queryByText('Cycling the coast for a fortnight.')).toBeNull();
    expect(screen.queryByText('Looking for a running partner.')).toBeNull();
    view.unmount();
    client.clear();
  });

  it('gives a traveler with no signed photo a monogram rather than a gap', async () => {
    // The edge function signs the lead today and may sign three tomorrow, so
    // every row has to read correctly with no URL at all.
    const { view, client } = show();
    expect(await screen.findByText('B')).toBeTruthy();
    expect(screen.getByText('C')).toBeTruthy();
    view.unmount();
    client.clear();
  });

  it('asks the photo function for a city and never for a person or a path', async () => {
    const { view, client } = show();
    await screen.findByText('Ana, 29');
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('featured-photo', { body: { city_id: 1 } })
    );
    view.unmount();
    client.clear();
  });

  it('heads the extra rows without claiming anybody is in the city now', async () => {
    // featured_traveler's window is `start_date <= current_date + 14`, so
    // "Also in Lisbon" asserted present location over people who may be nine
    // days from arriving — a presence claim, at group level, on a signed-out
    // device, in the app whose strongest safety promise is that it never
    // collects a location. The lead line twelve rows above it was rewritten
    // once for exactly this.
    const { view, client } = show();
    expect(await screen.findByText('More travelers with Lisbon plans')).toBeTruthy();
    expect(screen.queryByText('Also in Lisbon')).toBeNull();
    view.unmount();
    client.clear();
  });

  it('counts the rows it is heading, because two travelers leave one row', async () => {
    // featured_traveler returns up to three and often returns two, which puts
    // exactly one row under a plural heading.
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === 'featured_traveler' ? TRAVELERS.slice(0, 2) : [],
        error: null,
      })
    );
    const { view, client } = show();
    expect(await screen.findByText('One more traveler with Lisbon plans')).toBeTruthy();
    expect(screen.queryByText('More travelers with Lisbon plans')).toBeNull();
    view.unmount();
    client.clear();
  });

  it('draws each face against the name that came with it', async () => {
    // The photo answer is deliberately in a different order from the cards.
    // Read positionally, Cai's face would be drawn on Ana's card.
    invoke.mockResolvedValue({
      data: {
        photos: [
          { user_id: 'u3', url: 'https://example.test/u3.jpg' },
          { user_id: 'u1', url: 'https://example.test/u1.jpg' },
          { user_id: 'u2', url: 'https://example.test/u2.jpg' },
        ],
      },
      error: null,
    });
    const { view, client } = show();
    await screen.findByText('Ana, 29');
    // Every face on screen, in card order, against the names beside them.
    await waitFor(() =>
      expect(
        screen
          .UNSAFE_getAllByType(Image)
          .map((node) => (node.props.source as { uri?: string })?.uri)
          .filter(Boolean)
      ).toEqual([
        'https://example.test/u1.jpg',
        'https://example.test/u2.jpg',
        'https://example.test/u3.jpg',
      ])
    );
    view.unmount();
    client.clear();
  });

  it('gives a monogram to a traveler the photo call did not return', async () => {
    // Bea was banned, blocked, out of audience or out of trip between the two
    // calls, so the service role signed somebody this screen is not showing.
    // Nobody wears that face; Bea gets her initial.
    invoke.mockResolvedValue({
      data: {
        photos: [
          { user_id: 'u1', url: 'https://example.test/u1.jpg' },
          { user_id: 'u9', url: 'https://example.test/stranger.jpg' },
        ],
      },
      error: null,
    });
    const { view, client } = show();
    expect(await screen.findByText('B')).toBeTruthy();
    expect(
      screen.UNSAFE_getAllByType(Image).map((node) => (node.props.source as { uri?: string })?.uri)
    ).not.toContain('https://example.test/stranger.jpg');
    view.unmount();
    client.clear();
  });
});

const REPO = path.join(__dirname, '..', '..', '..', '..');
const read = (file: string) => fs.readFileSync(path.join(REPO, file), 'utf8');
/** Comments blanked, so a rule is never satisfied by prose describing it. */
const migration = read('supabase/migrations/20260902260000_a_guest_sees_more_than_one.sql').replace(
  /^\s*--.*$/gm,
  ''
);
const edgeFunction = read('supabase/functions/featured-photo/index.ts');

/**
 * The server half, which is where the count actually lives.
 *
 * pgTAP owns the behaviour. These three keep the shape from being tidied away
 * by somebody who does not know what it is load-bearing for, in a file no jest
 * run otherwise looks at.
 */
describe('the server the screen is reading', () => {
  it('returns three travelers rather than one', () => {
    expect(migration).toContain('where g.slot <= 3');
    expect(migration).not.toMatch(/limit 1\s*\$\$/);
  });

  it('keeps every guard the one-row version had, and adds the block', () => {
    // A widening, so nothing that narrowed it is allowed to go.
    expect(migration).toContain('and not public.viewer_is_business()');
    expect(migration).toContain('and public.discovery_pair_ok(auth.uid(), t.user_id)');
    expect(migration).toContain("and pp.moderation_status = 'approved'");
    expect(migration).toContain('and pp.position = 0');
    expect(migration).toContain("and u.status = 'active'");
    expect(migration).toContain('and p.onboarding_completed_at is not null');
    // Three screens promise "They're gone from the map and Travelers".
    expect(migration).toContain('and not public.is_blocked_pair(t.user_id)');
  });

  it('sends the rows under the lead less than it sends the lead', () => {
    // What is transported, not what is drawn. The rows render as a face, a
    // name, an age, a seal and dates, so that is what leaves the database.
    expect(migration).toContain('case when g.slot = 1 then g.bio end as bio');
    expect(migration).not.toMatch(/languages\s+text\[\]/);
  });

  it('gives every traveler one slot and every call the same order', () => {
    // One person with several windows in one city would otherwise be several
    // of the three faces, and an untotalled order would let the card call and
    // the photo call disagree about who is first - which puts one traveler's
    // face over another traveler's name.
    expect(migration).toContain('select distinct on (t.user_id)');
    expect(migration).toContain(
      'order by f.hellos desc, f.verified desc, f.created_at desc, f.user_id'
    );
  });

  it('asks who the travelers are as the caller, not as the service role', () => {
    // The guards inside featured_traveler() are all questions about
    // auth.uid(); a service-role call has none, so an admin RPC answered every
    // one of them for nobody and the block filter above excluded nobody on the
    // photo side. The row set comes from a per-request client built on the
    // caller's own Authorization header; the service role signs, and that is
    // all it does.
    expect(edgeFunction).toContain("await caller.rpc('featured_traveler'");
    expect(edgeFunction).not.toContain("admin.rpc('featured_traveler'");
    expect(edgeFunction).toContain("req.headers.get('Authorization')");
    // The one thing that still needs it: a private bucket whose only SELECT
    // policy is `to authenticated`.
    expect(edgeFunction).toContain('admin.storage');
  });

  it('signs a photo for every row and says whose each one is', () => {
    // `photos` is the contract the screen reads. `url` stays for the bundles
    // already on phones, which know nothing about `photos` and read exactly
    // that one field — checked against HEAD, not assumed.
    expect(edgeFunction).toContain('rows.map(async ({ user_id, photo_path })');
    expect(edgeFunction).toContain('return { user_id, url: signed.data.signedUrl };');
    expect(edgeFunction).toContain(
      'return Response.json({ url: photos[0]?.url ?? null, photos });'
    );
    expect(edgeFunction).not.toContain('data?.[0]');
    // And no bare positional list, ever. That is the shape that drew one
    // traveler's face under another traveler's name, and no ordering fix can
    // make it safe: the two calls are minted at different instants, so a row
    // set that changed between them re-attaches every face by one place.
    expect(edgeFunction).not.toMatch(/\burls\b\s*[,:}]/);
  });
});
