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

/**
 * Whether the root can commit to a stack yet.
 *
 * Routing has to hold on a cold start until the persisted session is back
 * and, for a member, until their profile and standing have settled —
 * otherwise people flash through the wrong stack. The hold renders instead
 * of the navigator, so while it is up the whole stack is unmounted and any
 * navigation in flight is lost.
 *
 * That is exactly what it cost a guest. Signing in flipped `signedIn` true
 * with both queries still pending, so the hold went up in the same tick that
 * guest-name called `router.replace(next)` — and when the stack came back it
 * came back at its anchor route. Somebody typed a name to open an invite and
 * landed on the map.
 *
 * A guest needs no lookup: owesOnboarding answers from the session alone, so
 * there is nothing to wait for and nothing gained by waiting.
 */
export function rootIsReady(opts: {
  initialized: boolean;
  session: Session | null;
  supabaseConfigured: boolean;
  profileSettled: boolean;
  standingSettled: boolean;
}) {
  if (!opts.initialized) {
    return false;
  }
  if (opts.session == null || !opts.supabaseConfigured) {
    return true;
  }
  if (opts.session.user.is_anonymous === true) {
    return true;
  }
  return opts.profileSettled && opts.standingSettled;
}
