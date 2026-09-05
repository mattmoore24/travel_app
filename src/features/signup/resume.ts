import type { Gender } from '@/lib/database.types';

/**
 * Where onboarding should open for somebody who has been here before.
 *
 * Every step saves on the way past it, deliberately, so nothing a person
 * typed is ever lost. What was lost was their POSITION: the screen opened at
 * step 3 whatever had already been answered, so anybody who quit at the photo
 * step, whose phone killed the app, or who reinstalled was walked back
 * through screens that each showed their own answer already filled in. That
 * reads as an app that did not register them the first time.
 *
 * The rule is derived rather than persisted, which is what keeps this out of
 * the database: one past the highest step that has data, floored at the first
 * REQUIRED step that is still unsatisfied. The floor is what makes it safe -
 * a profile can never resume past a step it has not actually cleared - and
 * "one past the highest with data" is what makes it honest about the skips,
 * so a person who passed the bio but added a trip comes back to socials
 * rather than being walked through four screens they chose to pass.
 *
 * Steps 11 (socials), 12 (badge) and 13 (audience) are not detectable from
 * here: handles are their own query, the badge is a check that takes minutes
 * and is asked for again from the profile anyway, and the audience has a
 * default that cannot be told from an answer. So 11 is the highest this can
 * return, and the clamp stops at the audience step, never at the review.
 * That is the right way round: resuming one step early costs a tap, resuming
 * one step late skips a question.
 */

export const RESUME_FIRST_STEP = 3;
export const RESUME_LAST_STEP = 13;

/** The columns of the profile row this decision reads, and nothing else. */
export type ResumeProfile = {
  display_name: string | null;
  age: number | null;
  gender: Gender;
  home_city: string | null;
  home_country: string | null;
  languages: string[];
  occupation: string | null;
  bio: string | null;
};

type ResumeInput = {
  profile: ResumeProfile;
  hasProfilePhoto: boolean;
  prompts: unknown[];
  priorities: unknown[];
  trips: unknown[];
};

/**
 * Step 3: the name, the age, and a gender that is not the column default.
 * Gender used to ride along on the strength of name and age being saved,
 * because "Rather not say" wrote the same 'unspecified' the default does. That
 * option is gone, so an account still at the default is one that has not
 * answered — including one that picked the opt-out before it went — and it
 * resumes on step 3 rather than past it.
 */
function basicsAnswered(profile: ResumeProfile): boolean {
  return profile.display_name != null && profile.age != null && profile.gender !== 'unspecified';
}

/** Step 4: somewhere to call home, and at least one language. */
function homeAnswered(profile: ResumeProfile): boolean {
  const place =
    (profile.home_city ?? '').trim().length > 0 || (profile.home_country ?? '').trim().length > 0;
  return place && profile.languages.length > 0;
}

export function resumeStep({
  profile,
  hasProfilePhoto,
  prompts,
  priorities,
  trips,
}: ResumeInput): number {
  // The highest step that has something on it. Ordered, so the last true one
  // wins and a gap in the middle (a skipped bio) does not stop the search.
  const answered: [number, boolean][] = [
    [3, basicsAnswered(profile)],
    [4, homeAnswered(profile)],
    [5, hasProfilePhoto],
    [6, (profile.occupation ?? '').trim().length > 0],
    [7, (profile.bio ?? '').trim().length > 0],
    [8, prompts.length > 0],
    [9, priorities.length > 0],
    [10, trips.length > 0],
  ];
  let highest = RESUME_FIRST_STEP - 1;
  for (const [step, hasData] of answered) {
    if (hasData) {
      highest = step;
    }
  }

  // The three steps with no skip button. A profile that has not cleared one
  // of these must not resume past it, whatever else it has on it.
  const required: [number, boolean][] = [
    [3, basicsAnswered(profile)],
    [4, homeAnswered(profile)],
    [5, hasProfilePhoto],
  ];
  const unsatisfied = required.find(([, ok]) => !ok);

  const next = Math.min(
    highest + 1,
    unsatisfied != null ? unsatisfied[0] : Number.POSITIVE_INFINITY
  );
  return Math.min(Math.max(next, RESUME_FIRST_STEP), RESUME_LAST_STEP);
}
