import { useQuery } from '@tanstack/react-query';
import type { ImageSource } from 'expo-image';

import { BUSINESS_PHOTO_BUCKET } from '@/features/business/api';
import { photoSource } from '@/lib/photo-source';
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

/**
 * The same cover, carrying its storage path as expo-image's cache key.
 *
 * The twin of `usePhotoSource` (features/profile/hooks), and it exists for the
 * same reason: a signed URL changes on every cold launch, so an `<Image>`
 * given a bare URL re-downloads a photo the phone already holds. A business
 * cover is the worst case of that — it is the first thing on the traveler's
 * business page, on My business, on the map sheet and in the header avatar, so
 * one listing is fetched four times over.
 *
 * Null while the URL is being signed and null when there is no photo, so a
 * caller keeps whatever it already renders in those two cases.
 */
export function useBusinessPhotoSource(storagePath: string | null): ImageSource | null {
  const { data } = useBusinessPhotoUrl(storagePath);
  return photoSource(data, storagePath);
}
