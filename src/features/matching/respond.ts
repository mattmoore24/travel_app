import { router } from 'expo-router';

import type { SaidHiOrigin } from '@/features/matching/said-hi';
import type { RespondTarget } from '@/features/profile/profile-view';
import type { RequestSource } from '@/lib/database.types';

/**
 * Open the composer already pointed at one thing on a profile.
 *
 * Both the travelers tab and a traveler's own profile page use this, so a
 * reply started from either place carries exactly the same context: the
 * element the request records, plus what the composer should show you are
 * answering.
 *
 * `source` is not cosmetic. send_message_request checks a DIFFERENT thing for
 * each one — 'trip_match' wants an overlapping trip, 'pin' wants a live pin —
 * and refuses with "recipient unavailable" when the check does not hold. This
 * used to be hardcoded to 'trip_match', so replying to a photo on a pinner's
 * profile was refused at the last step unless the two also happened to share
 * a trip, which is the whole point of the map not requiring one.
 *
 * `origin` is not the same question. `source` says what the SERVER should
 * check; `origin` says which screen to hand the beat back to. A hello from a
 * pinner's profile is source 'pin' and origin 'profile', and Travelers must
 * not paint a strip for it.
 */
export function openReply(input: {
  userId: string;
  name: string;
  photoPath: string | null;
  target: RespondTarget;
  source: RequestSource;
  origin: SaidHiOrigin;
}) {
  router.push({
    pathname: '/compose-request',
    params: {
      userId: input.userId,
      name: input.name,
      photoPath: input.photoPath ?? '',
      source: input.source,
      origin: input.origin,
      element: input.target.key,
      targetLabel: input.target.label,
      targetPhoto: input.target.photoPath ?? '',
      targetQuote: input.target.quote ?? '',
    },
  });
}
