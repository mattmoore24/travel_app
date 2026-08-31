import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { useRefetchOnRefocus } from '@/hooks/use-refetch-on-refocus';

import { useAuthStore } from '@/features/auth/store';
import { useIsBusiness, useListingIntent } from '@/features/business/hooks';
import type {
  CityPinRow,
  FeaturedTravelerRow,
  HeatCellRow,
  PublicPinRow,
} from '@/lib/database.types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Guest mode (docs/DESIGN.md). Signed-out visitors get the map, the heat
 * layer and one traveler; the account is only asked for at the moment of
 * action. The split lives here so screens stay declarative — they render
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
 * The single card a signed-out visitor sees on Travelers: whoever in this
 * city people are actually connecting with right now. Rotates constantly by
 * construction — it is a live ranking, not a designation.
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
      return ((data ?? []) as FeaturedTravelerRow[])[0] ?? null;
    },
    enabled: isSupabaseConfigured && cityId != null,
  });
}

/**
 * The featured traveler's face, for a device with no account.
 *
 * featured_traveler() returns a storage path, and a signed-out device cannot
 * turn a path into an image: the profile-photos bucket is private and its
 * only SELECT policy is `to authenticated`. So the card has been rendering a
 * monogram for somebody the server had already confirmed HAS an approved
 * photo - the audit's Top 6 asks for a face here, and the face could not
 * arrive.
 *
 * The featured-photo function mints one short-lived signed URL with the
 * service role. It takes a CITY, not a path and not a user: the server picks
 * the person exactly as this card does, so there is no parameter to walk and
 * no bucket to widen. Null is a normal answer (nobody featured, or nobody
 * with a face) and the monogram stays as the failure path.
 */
export function useFeaturedPhoto(cityId: number | null, hasPhoto: boolean) {
  return useQuery({
    queryKey: ['featured-photo', cityId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ url: string | null }>(
        'featured-photo',
        { body: { city_id: cityId } }
      );
      if (error) {
        throw error;
      }
      return data?.url ?? null;
    },
    // The URL is minted for five minutes; refetch before it dies.
    staleTime: 4 * 60_000,
    enabled: isSupabaseConfigured && cityId != null && hasPhoto,
  });
}
