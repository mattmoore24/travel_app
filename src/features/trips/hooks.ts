import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useOwnUserId } from '@/features/profile/hooks';
import { cancelTrip, createTrip, fetchMyTrips, searchCities } from '@/features/trips/api';
import { analytics } from '@/lib/analytics';
import { isSupabaseConfigured } from '@/lib/supabase';

export function useCitySearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['city-search', trimmed.toLowerCase()],
    queryFn: () => searchCities(trimmed),
    enabled: isSupabaseConfigured && trimmed.length >= 2,
    staleTime: Infinity, // reference data never changes within a session
  });
}

export function useMyTrips() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['trips', userId],
    queryFn: () => fetchMyTrips(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useCreateTrip() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { cityId: number; startDate: string; endDate: string; cityName: string }) =>
      createTrip(userId!, input.cityId, input.startDate, input.endDate),
    onSuccess: (trip, input) => {
      analytics.capture('trip_created', {
        city_id: trip.city_id,
        city_name: input.cityName,
        start_date: trip.start_date,
        end_date: trip.end_date,
      });
      queryClient.invalidateQueries({ queryKey: ['trips', userId] });
      queryClient.invalidateQueries({ queryKey: ['matches', userId] });
    },
  });
}

export function useCancelTrip() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => cancelTrip(tripId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips', userId] });
      queryClient.invalidateQueries({ queryKey: ['matches', userId] });
    },
  });
}
