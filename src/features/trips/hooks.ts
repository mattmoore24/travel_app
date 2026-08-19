import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useOwnUserId } from '@/features/profile/hooks';
import {
  cancelTrip,
  createTrip,
  deleteTrip,
  fetchMyTrips,
  fetchTravelerTrips,
  searchCities,
  updateTrip,
} from '@/features/trips/api';
import { daysUntil } from '@/features/trips/dates';
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
        // §6 retention is "within a trip window", not calendar — this lets
        // PostHog cohort on trips that start imminently (see DASHBOARD.md).
        starts_within_days: daysUntil(trip.start_date),
        trip_length_days: daysUntil(trip.end_date) - daysUntil(trip.start_date),
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
      analytics.capture('trip_cancelled');
      queryClient.invalidateQueries({ queryKey: ['trips', userId] });
      queryClient.invalidateQueries({ queryKey: ['matches', userId] });
    },
  });
}

/** Whatever the viewer is allowed to see of someone else's plans. */
export function useTravelerTrips(userId: string | null) {
  return useQuery({
    queryKey: ['traveler-trips', userId],
    queryFn: () => fetchTravelerTrips(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useUpdateTrip() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      tripId: string;
      cityId?: number;
      startDate?: string;
      endDate?: string;
    }) => updateTrip(input.tripId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips', userId] });
      queryClient.invalidateQueries({ queryKey: ['traveler-trips', userId] });
      queryClient.invalidateQueries({ queryKey: ['matches', userId] });
    },
  });
}

export function useDeleteTrip() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => deleteTrip(tripId),
    onSuccess: () => {
      analytics.capture('trip_deleted');
      queryClient.invalidateQueries({ queryKey: ['trips', userId] });
      queryClient.invalidateQueries({ queryKey: ['traveler-trips', userId] });
      queryClient.invalidateQueries({ queryKey: ['matches', userId] });
    },
  });
}
