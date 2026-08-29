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

/**
 * The five choices, and what each one means in BOTH directions.
 *
 * They used to live privately inside the picker screen. Three surfaces need
 * them now — the picker, the key selector at the top of the profile, and the
 * step during profile creation — and three copies of a sentence about who can
 * see you is exactly how two of them end up saying something slightly
 * different from the truth.
 *
 * Every detail names both directions on purpose. They once described a set
 * ("People who passed the selfie check"), which reads as a one-way filter on
 * what you are shown, and the founder tested it believing exactly that. The
 * detail is also the VoiceOver label for the row, so a one-way description
 * was the only thing a VoiceOver user got.
 */
export const AUDIENCE_OPTIONS: { value: ProfileAudience; detail: string }[] = [
  { value: 'everyone', detail: 'No filter, either way' },
  {
    value: 'verified',
    detail: 'Only verified travelers see you, and they are the only ones you see',
  },
  {
    value: 'verified_men',
    detail: 'Only verified men see you, and they are the only ones you see',
  },
  {
    value: 'verified_women',
    detail: 'Only verified women see you, and they are the only ones you see',
  },
  {
    value: 'verified_nonbinary',
    detail: 'Only verified non-binary travelers see you, and they are the only ones you see',
  },
];

/**
 * The one sentence that has to appear wherever this setting is offered.
 *
 * Three things surprise people who are not told: it cuts both ways, it does
 * nothing to chat, and the gendered options go by the gender on a profile so
 * anyone who has not set one is in none of them. Said once, in one place, so
 * the picker and the signup step cannot drift apart.
 */
export const AUDIENCE_BOTH_WAYS =
  'One setting, both ways. Only the people you pick can see you, and they are the only people you see on the map and in Travelers. Chat is separate: anyone can still message you.';

export const AUDIENCE_GENDER_NOTE =
  'Verified means they passed the selfie check. The three gendered options go by the gender on a profile, so anyone who has not set one is in none of them.';

/** Why the narrowed options are inert until the badge exists. */
export const AUDIENCE_NEEDS_BADGE = 'You need the badge before you can ask other people for one.';
