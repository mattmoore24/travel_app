import { router } from 'expo-router';

import type { RespondTarget } from '@/features/profile/profile-view';

/**
 * Open the composer already pointed at one thing on a profile.
 *
 * Both the travelers tab and a traveler's own profile page use this, so a
 * reply started from either place carries exactly the same context: the
 * element the request records, plus what the composer should show you are
 * answering.
 */
export function openReply(input: {
  userId: string;
  name: string;
  photoPath: string | null;
  target: RespondTarget;
}) {
  router.push({
    pathname: '/compose-request',
    params: {
      userId: input.userId,
      name: input.name,
      photoPath: input.photoPath ?? '',
      source: 'trip_match',
      element: input.target.key,
      targetLabel: input.target.label,
      targetPhoto: input.target.photoPath ?? '',
      targetQuote: input.target.quote ?? '',
    },
  });
}
