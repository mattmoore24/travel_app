/**
 * Signup is thirteen screens spanning two navigation stacks (the account is
 * created between step 2 and step 3, which is what moves the app from the
 * auth stack to onboarding). The count lives here so the progress bar stays
 * continuous across that handover.
 *
 * It was seven, and seven was too few for a reason that showed up in the
 * profiles people ended with: three whole sections — prompts, top priorities
 * and TRIPS — were never mentioned, so somebody finished signup with a photo
 * and a sentence while the Travelers screen is built to show prompts and
 * shared dates. Trips are the worst of the three, because trips are what the
 * matching runs on: a profile with no trip is invisible to the feature the
 * app exists for.
 *
 * So every part of a profile is asked for once, on its own screen, with a
 * line saying what it is for and where it shows up. Thirteen screens is more
 * screens and less work, because each one asks a single question and the
 * optional ones say so and can be passed in one tap. That is Hinge's shape
 * and the founder asked for it in as many words.
 *
 * See docs/ONBOARDING.md for the whole sequence and why each step sits where
 * it does.
 */
export const SIGNUP_TOTAL_STEPS = 13;

/** The last one, which is the profile itself. Named so nothing hardcodes 13. */
export const SIGNUP_REVIEW_STEP = SIGNUP_TOTAL_STEPS;

/**
 * A stable slug per 1-based step, for analytics. `signup_step_completed`
 * sends `{ step_index, step_name, skipped }`: the index is what a PostHog
 * funnel orders by (six of the thirteen steps used to emit nothing, and the
 * two that did sent a string where the rest sent an integer, so no funnel
 * chart could be drawn at all), and the name is what a human reads on it.
 * The slugs are part of the event schema — renaming one orphans its history.
 */
const SIGNUP_STEP_NAMES = [
  'email',
  'password',
  'who',
  'home',
  'photo',
  'occupation',
  'bio',
  'prompts',
  'priorities',
  'trip',
  'socials',
  'audience',
  'review',
] as const;

export function signupStepName(step: number): string {
  return SIGNUP_STEP_NAMES[step - 1] ?? `step-${step}`;
}
