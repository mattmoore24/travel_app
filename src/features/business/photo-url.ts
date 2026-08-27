import { useQuery } from '@tanstack/react-query';

import { BUSINESS_PHOTO_BUCKET } from '@/features/business/api';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Sign a business photo.
 *
 * `usePhotoUrl` cannot do this: it takes a path and nothing else and signs it
 * against `profile-photos`, so a business path put through it comes back a 404
 * wearing a valid-looking URL, which is the worst shape a bug can take.
 *
 * One copy, because four screens need it and a signing TTL that drifts between
 * them is a photo that goes blank on one screen and not another. Same rhythm
 * as the profile hook: sign for fifty minutes, hold the answer for forty, so
 * the cached URL always outlives its own staleness.
 */
const TTL_SECONDS = 3000;

export function useBusinessPhotoUrl(storagePath: string | null) {
  return useQuery({
    queryKey: ['business-photo-url', storagePath],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(BUSINESS_PHOTO_BUCKET)
        .createSignedUrl(storagePath!, TTL_SECONDS);
      if (error) {
        throw error;
      }
      return data.signedUrl;
    },
    enabled: isSupabaseConfigured && storagePath != null,
    staleTime: 40 * 60 * 1000,
    gcTime: 45 * 60 * 1000,
  });
}
