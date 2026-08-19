import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createPin,
  deletePin,
  fetchCityPins,
  fetchHeatCells,
  fetchLaunchCities,
} from '@/features/pins/api';
import { useOwnUserId } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';
import type { PinCategory } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

export function useLaunchCities() {
  return useQuery({
    queryKey: ['launch-cities'],
    queryFn: fetchLaunchCities,
    enabled: isSupabaseConfigured,
    staleTime: 60 * 60 * 1000, // launch cities change on founder action, not per-session
  });
}

export function useCityPins(cityId: number | null) {
  return useQuery({
    queryKey: ['city-pins', cityId],
    queryFn: () => fetchCityPins(cityId!),
    enabled: isSupabaseConfigured && cityId != null,
    staleTime: 20_000,
    // The map tab stays mounted; without polling, expired pins would linger
    // until an app background/foreground cycle.
    refetchInterval: 60_000,
  });
}

export function useHeatCells(cityId: number | null, date: string | null) {
  return useQuery({
    queryKey: ['heat-cells', cityId, date],
    queryFn: () => fetchHeatCells(cityId!, date),
    enabled: isSupabaseConfigured && cityId != null,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useCreatePin() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      cityId: number;
      venueName: string;
      note?: string | null;
      placeLabel?: string | null;
      category: PinCategory;
      lat: number;
      lng: number;
      intentDate: string;
      expiresAt: string;
    }) => createPin({ userId: userId!, ...input }),
    onSuccess: (pin) => {
      analytics.capture('pin_created', {
        city_id: pin.city_id,
        category: pin.category,
        intent_date: pin.intent_date,
      });
      // Both cache families: 'city-pins'/'heat-cells' feed the web list,
      // 'map-pins'/'map-heat' (guest hooks) feed the native map. Missing the
      // second pair meant a posted pin never appeared until app restart.
      queryClient.invalidateQueries({ queryKey: ['city-pins', pin.city_id] });
      queryClient.invalidateQueries({ queryKey: ['heat-cells', pin.city_id] });
      queryClient.invalidateQueries({ queryKey: ['map-pins', pin.city_id] });
      queryClient.invalidateQueries({ queryKey: ['map-heat', pin.city_id] });
    },
  });
}

export function useDeletePin(cityId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pinId: string) => deletePin(pinId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['city-pins', cityId] });
      queryClient.invalidateQueries({ queryKey: ['heat-cells', cityId] });
      queryClient.invalidateQueries({ queryKey: ['map-pins', cityId] });
      queryClient.invalidateQueries({ queryKey: ['map-heat', cityId] });
    },
  });
}
