/** When this JS session started. Module scope, so a remount does not reset it. */
const SESSION_START_MS = Date.now();

/** Clock slack between the server stamping onboarding and this device. */
const SESSION_GRACE_MS = 10 * 60_000;

/**
 * "Just finished signup", NOT "has finished signup" — the latter is true
 * forever, and two different surfaces now turn on the difference: the map's
 * first-session strip, and the one moment the app asks about notifications
 * before anybody has done anything to earn the question.
 *
 * Inside this app session, with a little grace for the gap between the server
 * stamping the row and this device's clock. It lives here rather than in
 * either caller because a second copy of this rule would drift, and the two
 * surfaces that read it are meant to be the same moment.
 */
export function justOnboarded(onboardingCompletedAt: string | null | undefined): boolean {
  if (!onboardingCompletedAt) {
    return false;
  }
  const at = Date.parse(onboardingCompletedAt);
  return Number.isFinite(at) && at >= SESSION_START_MS - SESSION_GRACE_MS;
}
