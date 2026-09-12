import type { Session } from '@supabase/supabase-js';

import { accountLoadFailure } from '@/features/auth/load-error';
import { isOffline } from '@/lib/failure-message';

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
export function owesOnboarding(
  session: Session | null,
  onboardedAt: string | null | undefined,
  isBusiness = false,
  wantsBusiness = false
) {
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
  if (isBusiness) {
    // The same trap, one account kind later. A business account's
    // `onboarding_completed_at` stays NULL FOREVER, by design: that stamp is
    // what makes somebody a discoverable traveler, and a business must never
    // be one. Without this branch the expression below would read that
    // permanent null as "unfinished" and hold every business in a traveler
    // onboarding flow it can never complete.
    return false;
  }
  if (wantsBusiness) {
    // The same trap a third time, and the only one where the account kind is
    // still being decided. Somebody part way through listing a business is
    // not a traveler who has not finished: register_business REFUSES an
    // account that carries onboarding_completed_at, so walking them through
    // traveler onboarding is walking them into a locked door.
    //
    // False, which mounts the tabs, and mounting the tabs is the point:
    // steps 4 to 11 of the listing form had no exit at all, so it is the tabs
    // that give somebody backing out of it somewhere to back out TO.
    // Returning a third value and mounting business-signup as the stack would
    // leave the back button with nowhere to go, which is the bug this closes.
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
  /**
   * getSession() answered "could not check" rather than "none". Held, with
   * the offline card over the hold, because the alternative is showing a
   * signed-in person the guest map. See `sessionIsUnknown` below and the
   * flag's note in features/auth/store.
   */
  sessionUnknown: boolean;
  supabaseConfigured: boolean;
  profileSettled: boolean;
  standingSettled: boolean;
  /**
   * Whether the account-kind lookup has answered. Held for the same reason
   * as the other two: commit before it lands and a business flashes through
   * the traveler tabs on every cold start.
   */
  businessSettled: boolean;
  /**
   * Whether "is this account part way through listing a business" has
   * answered. Held for the same reason as the other three, and the cost of
   * committing early is the highest of the four: a bar owner is dropped into
   * traveler onboarding, whose last step the server refuses forever.
   */
  listingSettled: boolean;
}) {
  if (!opts.initialized) {
    return false;
  }
  if (opts.sessionUnknown) {
    return false;
  }
  if (opts.session == null || !opts.supabaseConfigured) {
    return true;
  }
  if (opts.session.user.is_anonymous === true) {
    return true;
  }
  return opts.profileSettled && opts.standingSettled && opts.businessSettled && opts.listingSettled;
}

/**
 * Whether a getSession() result means "could not check" rather than "none".
 *
 * auth-js keeps the session on disk when a refresh fails RETRYABLY (its
 * AuthRetryableFetchError: the request never arrived, or the server said
 * try later) and hands back `{ session: null, error }`. Reading that null as
 * signed out silently demoted a signed-in traveler to a visitor for as long
 * as the plane was in the air. A non-retryable refresh failure is different:
 * auth-js removes the session itself and emits SIGNED_OUT, and that null is
 * a real answer.
 *
 * `isOffline` as the second test because it is the app's one classifier for
 * "never reached the server" (lib/failure-message), and an error that fails
 * it while carrying the retryable name is still retryable.
 */
export function sessionIsUnknown(result: { session: Session | null; error: unknown }): boolean {
  if (result.session != null || result.error == null) {
    return false;
  }
  const name = (result.error as { name?: unknown }).name;
  return name === 'AuthRetryableFetchError' || isOffline(result.error);
}

/**
 * What the root does with a failed boot read of the account (the profile
 * row, or the business row that decides which app somebody gets).
 *
 *   'proceed' — nothing to do: not signed in, a guest, no failure, or the
 *               failure is a BACKGROUND one with the row still in memory.
 *   'hold'    — keep the splash-coloured hold up. The failure is offline and
 *               nothing has reached the server since launch, so the offline
 *               card (components/ui/offline-notice) is already on screen
 *               saying so with a Try again; the account error screen would
 *               be a second voice for the same fact.
 *   'block'   — the account error screen: the row is gone, the server
 *               failed, or the phone went offline in a warm app.
 *
 * A guest never blocks and never holds. useOwnProfile is enabled for an
 * anonymous session (guests have a profiles row), so ~24 seconds into an
 * offline cold start the map they were looking at was torn down for "Can't
 * load your profile" and a Sign out that would have thrown away their guest
 * identity. Their routing never depended on the row (see rootIsReady), so
 * its failure is never a reason to unmount their navigator.
 */
export type AccountLoadVerdict = 'proceed' | 'hold' | 'block';

export function accountLoadVerdict(opts: {
  session: Session | null;
  isError: boolean;
  hasData: boolean;
  error: unknown;
  everReached: boolean;
}): AccountLoadVerdict {
  if (opts.session == null || opts.session.user.is_anonymous === true) {
    return 'proceed';
  }
  if (!opts.isError || opts.hasData) {
    return 'proceed';
  }
  if (accountLoadFailure(opts.error) === 'gone') {
    return 'block';
  }
  if (isOffline(opts.error) && !opts.everReached) {
    return 'hold';
  }
  return 'block';
}
