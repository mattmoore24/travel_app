import { countOf, isAre } from '@/lib/plural';

/**
 * Copy for the guest Travelers screen, kept as functions of the SAME
 * `featured` value the screen branches on, so the two halves can never
 * contradict each other again. The shipped defect was exactly that: the
 * empty branch said "Nobody in town this week." while the sign-up card
 * below it promised "See everyone else in town" — two sentences on one
 * screen saying opposite things, on the launch-day branch
 * (LAUNCH_RUNBOOK step 4 purges the demo travelers before real users
 * arrive).
 */

/** The sign-up card's reason line. */
export function guestGateReason(
  featuredName: string | null | undefined,
  hasFeatured: boolean,
  cityName: string | null | undefined
): string {
  if (hasFeatured) {
    return `Make a profile to say hi to ${featuredName ?? 'them'}`;
  }
  // An empty city cannot promise "everyone else". Being early is the only
  // honest pitch, and it is a real one.
  return cityName ? `Be one of the first travelers in ${cityName}` : 'Be one of the first here';
}

/**
 * What the screen says when featured_traveler returns nobody. When the map
 * holds plans, say so: the aggregate count is the same faceless evidence the
 * guest map already serves, and it is the difference between "dead city" and
 * "no profiles yet". No individual pin is ever named to a signed-out guest.
 */
export function guestEmptyCityLine(planCount: number, cityName: string | null | undefined): string {
  if (planCount > 0 && cityName) {
    return `No profiles to show yet. ${countOf(planCount, 'plan')} ${isAre(
      planCount
    )} on the map in ${cityName} this week.`;
  }
  return 'Nobody in town this week.';
}
