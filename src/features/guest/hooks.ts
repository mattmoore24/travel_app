import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { useRefetchOnRefocus } from '@/hooks/use-refetch-on-refocus';

import { useAuthStore } from '@/features/auth/store';
import { useIsBusiness, useListingIntent, useOwnBusiness } from '@/features/business/hooks';
import type {
  CityPinRow,
  FeaturedTravelerRow,
  HeatCellRow,
  PublicPinRow,
} from '@/lib/database.types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Guest mode (docs/DESIGN.md). Signed-out visitors get the map, the heat
 * layer and the featured travelers; the account is only asked for at the
 * moment of action. The split lives here so screens stay declarative — they render
 * whatever the hook returns and show a gate when `isGuest`.
 *
 * There are now TWO ways to not be a member, and this hook deliberately
 * answers true for both. A named guest (anonymous sign-in, 20260823060000)
 * has a session, so `session == null` alone would have quietly handed them
 * the whole member app: pins, Travelers, say-hi. Every one of those is
 * refused by the database, so the only thing that change would have bought
 * is a screen full of buttons that fail. "Not a member" is the question
 * every caller is actually asking.
 */
export function useIsGuest() {
  return useAuthStore((s) => s.session == null || s.session.user.is_anonymous === true);
}

/**
 * Part way through listing a business, from either half of the answer.
 *
 * The auth store's flag is right within one sitting; the column survives a
 * cold start. Both, because the column is written a beat after the chooser
 * and the store is empty after a relaunch.
 */
export function useWantsBusiness() {
  const listingIntent = useAuthStore((s) => s.listingIntent);
  const { data } = useListingIntent();
  return listingIntent || data === true;
}

/**
 * No session at all, as opposed to a guest who has one.
 *
 * Only for the few places where the difference is the point: whether to
 * offer "join as a guest" (nothing to join as, yet) versus "make an account"
 * (they already have a name and a history to carry over).
 */
export function useIsSignedOut() {
  return useAuthStore((s) => s.session == null);
}

/** A guest specifically: named, session-carrying, not a member. */
export function useIsGuestAccount() {
  return useAuthStore((s) => s.session?.user.is_anonymous === true);
}

/**
 * What kind of account is looking at this, in the five words analytics is
 * allowed to know. Never a name, never an id.
 */
export type AccountType = 'signed_out' | 'guest' | 'traveler' | 'business' | 'unknown';

/**
 * The account kind, for the property every event carries (docs/DASHBOARD.md).
 *
 * This exists because "map DAU vs matching DAU" is the number that decides
 * whether the map-led thesis is true, and it is biased upward on the map
 * side by exactly the number of business accounts: components/app-tabs.tsx
 * renders the map trigger unconditionally and hides Travelers from a
 * business, so a business can reach one side of the ratio and is
 * structurally barred from the other. Without this property the split cannot
 * be reconstructed after the fact, and as listings grow the ratio drifts in
 * the direction the founder wants to see for a reason that has nothing to do
 * with travelers. A flattering failure is the dangerous kind.
 *
 * 'unknown' IS AN ANSWER, and refusing to guess is the point. useOwnBusiness
 * settles a beat after the first paint — the same race app-tabs.tsx
 * documents for the tab list — so an account kind assumed before then is
 * wrong for a business every time, invisibly. Everywhere else in the app the
 * settling answer is "not a business", because that is the kinder UX; here
 * the cost of being wrong is the metric quietly flattering itself, so an
 * unresolved kind says so and the chart can exclude it.
 *
 * Mid-listing counts as 'business' rather than as a traveler who has not
 * finished, matching what useMapPins already does with the same fact: for
 * the purpose of this number a non-traveler on the map is a non-traveler on
 * the map.
 */
export function useAccountType(): AccountType {
  const signedOut = useIsSignedOut();
  const guestAccount = useIsGuestAccount();
  const business = useOwnBusiness();
  const listing = useListingIntent();
  const listingIntent = useAuthStore((s) => s.listingIntent);

  if (signedOut) {
    return 'signed_out';
  }
  if (guestAccount) {
    // Both queries above are disabled for an anonymous session, so they
    // never settle and this has to answer before the settle check below.
    return 'guest';
  }
  // A positive answer needs no settle: data in hand IS settled, and the
  // in-memory listing flag is the fast path a cold start does not have.
  if (business.data != null || listingIntent) {
    return 'business';
  }
  const settled =
    (business.isSuccess || business.isError) && (listing.isSuccess || listing.isError);
  if (!settled) {
    return 'unknown';
  }
  return listing.data === true ? 'business' : 'traveler';
}

/**
 * Pins for the map. Travelers get the identity-carrying feed; guests and
 * businesses get the same pins with no names, ages or photos attached — the
 * server enforces that, this just picks the door.
 *
 * A business reads this map to see the city it is in, not the people on it.
 * `city_pins` carries a name, an age, a face and a verified badge per pin, so
 * a bar owner opening the Map tab was handed a traveler directory nobody
 * offered to them and nobody consented to (§7 rule 8: a business never reads
 * a traveler discovery surface). Same door as a guest, for the same reason:
 * the rows have no identities in them at all.
 *
 * THREE kinds now, not two. An account part way through listing a business is
 * about to be covered by that same rule, and mounting the tabs for it (which
 * is what gives somebody backing out of the listing form somewhere to go) is
 * what put it in front of this feed at all. There is no reason to hand it
 * names while it waits.
 */
export function useMapPins(cityId: number | null) {
  const isGuest = useIsGuest();
  const isBusiness = useIsBusiness();
  const wantsBusiness = useWantsBusiness();
  const anonymous = isGuest || isBusiness || wantsBusiness;
  const focused = useIsFocused();
  const query = useQuery({
    // The DOOR, not the account kind, and a word rather than a boolean. Two
    // kinds of account now share the anonymous feed, so `isGuest` in the key
    // would have let a business's faceless rows be served to a traveler who
    // signed in on the same device, and the traveler's named rows to the
    // business.
    queryKey: ['map-pins', cityId, anonymous ? 'anonymous' : 'identified'],
    queryFn: async () => {
      const rpc = anonymous ? 'public_city_pins' : 'city_pins';
      const { data, error } = await supabase.rpc(rpc, { p_city_id: cityId! });
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as PublicPinRow[] | CityPinRow[];
      // Normalise to the richer shape so the map renders one way.
      return rows.map((row) => ({
        user_id: null,
        display_name: null,
        age: null,
        verified: false,
        photo_path: null,
        ...row,
      })) as CityPinRow[];
    },
    enabled: isSupabaseConfigured && cityId != null,
    // Poll only while the Map tab is the one being looked at. The tab stays
    // mounted for the whole foreground session, so without polling a pin that
    // burned out at 22:00 was still drawn at 22:30 — but an unconditional
    // interval kept paying that request-a-minute from inside a chat too. The
    // short the refocus hook refetches the moment the tab comes back, which is the
    // only moment lingering could be seen.
    staleTime: 20_000,
    refetchInterval: focused ? 60_000 : false,
  });
  useRefetchOnRefocus(focused, query);
  return query;
}

export function useMapHeat(cityId: number | null, date: string | null) {
  const isGuest = useIsGuest();
  const focused = useIsFocused();
  const query = useQuery({
    queryKey: ['map-heat', cityId, date, isGuest],
    queryFn: async () => {
      const rpc = isGuest ? 'public_heat_cells' : 'heat_cells';
      const { data, error } = await supabase.rpc(rpc, {
        p_city_id: cityId!,
        p_date: date,
      });
      if (error) {
        throw error;
      }
      return (data ?? []) as HeatCellRow[];
    },
    enabled: isSupabaseConfigured && cityId != null,
    // Same reason and same tab-scoping as the pins it sits under: the heat
    // has to cool as pins burn out, but only while anyone is watching it.
    staleTime: 20_000,
    refetchInterval: focused ? 60_000 : false,
  });
  useRefetchOnRefocus(focused, query);
  return query;
}

/**
 * The travelers a signed-out visitor sees: whoever in this city people are
 * actually connecting with right now. Rotates constantly by construction — it
 * is a live ranking, not a designation.
 *
 * THE ROWS, not the first one. One face cannot answer "are there people here
 * on my dates", which is the only question the Travelers tab exists to answer
 * for somebody with no account, and a dead city is this category's number one
 * killer. The server decides how many there are: featured_traveler() picks
 * them, applies viewer_is_business() and discovery_pair_ok(), and returns the
 * same safe projection it always did. Nothing here widens what arrives per
 * person — the count is the only thing that changes, and it changes in the
 * database.
 *
 * So this hook is correct on both sides of that deploy: one row today, three
 * once the migration lands, and the screen renders whatever it is handed.
 */
export function useFeaturedTraveler(cityId: number | null) {
  return useQuery({
    queryKey: ['featured-traveler', cityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('featured_traveler', {
        p_city_id: cityId!,
      });
      if (error) {
        throw error;
      }
      return (data ?? []) as FeaturedTravelerRow[];
    },
    enabled: isSupabaseConfigured && cityId != null,
  });
}

/**
 * The featured travelers' faces, for a device with no account.
 *
 * featured_traveler() returns a storage path, and a signed-out device cannot
 * turn a path into an image: the profile-photos bucket is private and its
 * only SELECT policy is `to authenticated`. So the card has been rendering a
 * monogram for somebody the server had already confirmed HAS an approved
 * photo - the audit's Top 6 asks for a face here, and the face could not
 * arrive.
 *
 * `byUser` is the answer, `positional` is the fallback, and the difference is
 * the point of this type. The edge function used to hand back a bare list of
 * URLs and the screen indexed it against the cards, which is only sound while
 * both calls to featured_traveler() see the same people in the same order -
 * and they do not, because its guards are evaluated per PERSON and the two
 * calls happen seconds apart. Somebody banned, blocked, out of audience or
 * out of trip drops from one row set and not the other, everything after them
 * shifts up one, and a real traveler's face lands under another real
 * traveler's name. Reading by user_id turns that into a monogram, which is
 * the failure path the card was designed around.
 *
 * That gap is now only the seconds. It used to be structural: the edge
 * function asked for its rows with the SERVICE role, which has no auth.uid(),
 * so the block and audience guards excluded nobody on that side and the two
 * row sets disagreed by construction. It asks as the caller now
 * (supabase/functions/featured-photo/index.ts), so both sides answer the same
 * guards for the same person.
 */
export type FeaturedPhotos = {
  /** user_id to signed URL. Null only when the deployed function is older. */
  byUser: Record<string, string | null> | null;
  /** The lead face from an older server, at index 0. Read ONLY when `byUser` is null. */
  positional: (string | null)[];
};

/**
 * One traveler's face, by identity where the server offers it and by list
 * position only where it does not.
 */
export function featuredPhotoFor(
  photos: FeaturedPhotos | undefined,
  userId: string,
  index: number
): string | null {
  if (photos == null) {
    return null;
  }
  if (photos.byUser != null) {
    // Absent means this traveler was not in the row set the URLs were minted
    // for. A monogram, never the face sitting at their index.
    return photos.byUser[userId] ?? null;
  }
  return photos.positional[index] ?? null;
}

/**
 * The faces, for the travelers currently on screen.
 *
 * The featured-photo function mints short-lived signed URLs with the service
 * role, and uses that role for the minting and nothing else: it looks the
 * travelers up with the caller's own credentials, so a blocked traveler is
 * missing from the faces exactly as they are missing from the cards. It takes
 * a CITY, not a path and not a user: the server picks the people exactly as
 * the cards do, so there is no parameter to walk and no bucket to widen. A
 * missing entry is a normal answer (nobody featured, or nobody with a face)
 * and the monogram stays as the failure path.
 *
 * THE ROSTER IS IN THE KEY because the two lists run on two different clocks.
 * featured_traveler is ordered by hellos over a rolling window, so the ranking
 * is live and useFeaturedTraveler refetches on the global 30s staleTime, while
 * these URLs are minted for five minutes and are pinned here for four. Keyed
 * on the city alone, a list that had refreshed was drawn against faces minted
 * for the people who used to be in it. Keyed on who is actually on screen, a
 * changed row set is a different query and fetches its own faces.
 */
export function useFeaturedPhoto(cityId: number | null, featured: FeaturedTravelerRow[]) {
  const roster = featured
    .filter((traveler) => traveler.photo_path != null)
    .map((traveler) => traveler.user_id)
    .join(',');
  return useQuery({
    queryKey: ['featured-photo', cityId, roster],
    queryFn: async (): Promise<FeaturedPhotos> => {
      const { data, error } = await supabase.functions.invoke<{
        url?: string | null;
        photos?: { user_id: string; url: string | null }[];
      }>('featured-photo', { body: { city_id: cityId } });
      if (error) {
        throw error;
      }
      // EVERY SHAPE, and this is not defensive padding. The gap is between
      // this BUNDLE and the server, not between the function and its
      // migrations: .github/workflows/supabase-deploy.yml runs `supabase db
      // push` and then `supabase functions deploy` as two steps of one job, so
      // the database and the function land together. The app is the other
      // workflow, ships over the air, and is never applied on the launch that
      // downloads it — so a phone runs an older bundle against a newer server
      // for at least one more launch, and a newer bundle can equally reach an
      // older server if the app ships first. Reading the newest shape alone
      // would have taken the guest's faces away — the exact regression the
      // function was written to fix — for as long as either lasted.
      if (Array.isArray(data?.photos)) {
        const byUser: Record<string, string | null> = {};
        for (const photo of data.photos) {
          byUser[photo.user_id] = photo.url ?? null;
        }
        return { byUser, positional: data.photos.map((photo) => photo.url ?? null) };
      }
      return { byUser: null, positional: data?.url != null ? [data.url] : [] };
    },
    // The URLs are minted for five minutes; refetch before they die.
    staleTime: 4 * 60_000,
    enabled: isSupabaseConfigured && cityId != null && roster !== '',
  });
}
