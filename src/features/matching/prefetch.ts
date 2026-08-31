import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect } from 'react';

import { fetchPhotos, fetchPublicProfile, signedPhotoUrl } from '@/features/profile/api';

/**
 * How many cards ahead of the one on screen are fetched.
 *
 * Two, and this is a ceiling rather than a starting point. Prefetching the
 * whole queue would mint a signed URL for every traveler in the city and fill
 * the image cache with faces nobody looked at; one is not enough, because the
 * whole loop is read a person, tap Next, read the next person.
 */
export const PREFETCH_AHEAD = 2;

/** Just enough of a queued traveler to fetch what their card will need. */
export type PrefetchTarget = { userId: string; photoPath: string | null };

/**
 * Have the next traveler's face already downloaded when the card turns.
 *
 * What happens without it: the new page mounts, fades in over 200ms, and only
 * THEN starts the chain — the profile and the photo list on mount, a signed
 * URL after those, the image download after that. So the first thing anybody
 * saw of every traveler was an empty surfaceSunken frame where their face
 * goes, on the screen whose entire pitch is that there is a real person
 * there.
 *
 * The match row already carries `photo_path`, which is what lets the signed
 * URL be minted without waiting on the photos query first.
 *
 * Nothing here crosses a visibility boundary: these are the same RLS-gated
 * queries the viewer is about to be served anyway, one card earlier.
 */
export function useNextTravelersPrefetch(queue: PrefetchTarget[]) {
  const queryClient = useQueryClient();
  // Serialised because the array is a new object on every render, and an
  // effect that re-runs every render would re-ask for everything on every
  // scroll. The key IS the dependency, and it is parsed back inside so the
  // dependency list stays honest rather than silenced with a lint comment.
  const ahead = JSON.stringify(queue.slice(1, 1 + PREFETCH_AHEAD));

  useEffect(() => {
    const targets: PrefetchTarget[] = JSON.parse(ahead);
    for (const target of targets) {
      queryClient
        .prefetchQuery({
          queryKey: ['public-profile', target.userId],
          queryFn: () => fetchPublicProfile(target.userId),
        })
        .catch(() => {});
      queryClient
        .prefetchQuery({
          queryKey: ['public-photos', target.userId],
          queryFn: () => fetchPhotos(target.userId),
        })
        .catch(() => {});
      const path = target.photoPath;
      if (!path) {
        continue;
      }
      queryClient
        .prefetchQuery({
          queryKey: ['photo-url', path],
          queryFn: () => signedPhotoUrl(path),
          // The same window usePhotoUrl holds, so a prefetched URL is not
          // re-minted the moment the card actually opens.
          staleTime: PHOTO_URL_STALE_MS,
        })
        .then(() => {
          const url = queryClient.getQueryData<string>(['photo-url', path]);
          if (url) {
            // The download itself. A signed URL in the cache is only half of
            // it: without this the image request still starts on mount.
            return Image.prefetch(url);
          }
          return false;
        })
        .catch(() => {
          // A face that fails to arrive early simply arrives late, which is
          // exactly what happened before this existed.
        });
    }
  }, [ahead, queryClient]);
}

/** Mirrors usePhotoUrl's window against a one-hour signing TTL. */
const PHOTO_URL_STALE_MS = 50 * 60 * 1000;
