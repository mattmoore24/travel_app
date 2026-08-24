import type { ProfileAudience } from '@/lib/database.types';

/**
 * One name per audience, shared by every screen that says it out loud.
 *
 * Three screens need to name the setting now: the picker, the Travelers
 * empty state and the map's empty banner. When the labels lived privately
 * inside the picker, the other two either said nothing or would have
 * invented their own wording for the same thing.
 */
export const AUDIENCE_LABEL: Record<ProfileAudience, string> = {
  everyone: 'Everyone',
  verified: 'Verified only',
  verified_men: 'Verified men',
  verified_women: 'Verified women',
  verified_nonbinary: 'Verified non-binary',
};

/**
 * The same name mid-sentence. "You are set to verified only" rather than
 * "set to Verified only", which reads like a proper noun nobody introduced.
 */
export function audienceInSentence(audience: ProfileAudience) {
  return AUDIENCE_LABEL[audience].toLowerCase();
}
