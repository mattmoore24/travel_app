import type { Session } from '@supabase/supabase-js';

/**
 * Which stack somebody belongs in at the root.
 *
 * Its own function with its own tests because the obvious expression is
 * wrong. Routing used to swap on `signedIn && !onboarded`, which reads
 * correctly right up until guests existed: a guest HAS a session and can
 * never be onboarded, because the database refuses that stamp on purpose
 * (guest_profile_stays_minimal — the stamp is what makes somebody
 * discoverable). So typing a name dropped the tabs, mounted onboarding, and
 * left the guest in a flow whose last step the server would refuse forever.
 *
 * Nothing else in the app would have noticed. Every migration test passed,
 * every unit test passed, and the feature was unusable.
 */
export function owesOnboarding(session: Session | null, onboardedAt: string | null | undefined) {
  if (session == null) {
    // A visitor with no account browses the app. That is guest mode, and it
    // is the front door (docs/DESIGN.md).
    return false;
  }
  if (session.user.is_anonymous === true) {
    // A guest is finished the moment they have a name. Asking them for a
    // profile is asking for the account they declined.
    return false;
  }
  return onboardedAt == null;
}
