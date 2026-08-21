import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/store';
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
 */
export function useIsGuest() {
  return useAuthStore((s) => s.session == null);
}

/**
 * Pins for the map. Signed-in callers get the identity-carrying feed; guests
 * get the same pins with no names, ages or photos attached — the server
 * enforces that, this just picks the door.
 */
export function useMapPins(cityId: number | null) {
  const isGuest = useIsGuest();
  return useQuery({
    queryKey: ['map-pins', cityId, isGuest],
    queryFn: async () => {
      const rpc = isGuest ? 'public_city_pins' : 'city_pins';
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
    // The map tab stays mounted for the whole foreground session, so without
    // polling a pin that burned out at 22:00 was still drawn at 22:30 —
    // tappable, with a card offering to message somebody about a plan that is
    // over. useCityPins (the web list) already carried this; the native map,
    // which is what anyone actually uses, did not.
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useMapHeat(cityId: number | null, date: string | null) {
  const isGuest = useIsGuest();
  return useQuery({
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
    // Same reason as the pins it sits under: the heat has to cool as pins
    // burn out, not at the next cold start.
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
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
