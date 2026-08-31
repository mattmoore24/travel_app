import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import AppTabs from '@/components/app-tabs';
import { useAuthStore } from '@/features/auth/store';
import { useIsBusiness } from '@/features/business/hooks';
import { useIsGuest } from '@/features/guest/hooks';
import { ConnectedNotice } from '@/features/matching/connected-notice';
import { useAcceptedCelebration } from '@/features/matching/use-accepted-celebration';
import { PushPrimer } from '@/features/notifications/push-primer';
import { useNotificationRouting } from '@/features/notifications/use-notification-routing';

/**
 * Gives back the invite somebody was holding when they went off to make an
 * account.
 *
 * Signing up replaces the navigator wholesale — auth stack, then onboarding,
 * then the tabs — so a `router.push` fired from the invite screen could never
 * survive the trip. The token is parked in the auth store instead and spent
 * here, at the first moment there is a mounted stack and a real session. It
 * renders nothing.
 */
function PendingInviteHandoff() {
  const token = useAuthStore((s) => s.pendingInvite);
  const signedIn = useAuthStore((s) => s.session != null);
  const inviteHandled = useAuthStore((s) => s.inviteHandled);
  // Somebody listing a business is mid-flow: `join` fires its own replace to
  // /business-signup the moment the account exists, and two navigations
  // racing to the top of one stack is a coin toss. The flag is cleared by the
  // listing form itself, and clearing it re-runs this effect — so the invite
  // is handed back after the listing rather than instead of it.
  const listingIntent = useAuthStore((s) => s.listingIntent);
  // A business account has nothing to spend an invite on. The join screen
  // says so plainly when one arrives by link, which is right for a tap
  // somebody just made; handing it back UNPROMPTED at the end of listing a
  // business is a different thing, and the first screen after signing up
  // should be the business, not a group refusal.
  const viewerIsBusiness = useIsBusiness();

  useEffect(() => {
    if (!signedIn || !token || listingIntent) {
      return;
    }
    if (viewerIsBusiness) {
      inviteHandled();
      return;
    }
    // Cleared BEFORE the push, not after: the invite screen is a route like
    // any other and can be backed out of, and a token still sitting in the
    // store would push it straight back on.
    inviteHandled();
    router.push(`/join-group/${token}`);
  }, [signedIn, token, listingIntent, viewerIsBusiness, inviteHandled]);

  return null;
}

/**
 * A business lands on My business, not the Map (founder decision D8).
 *
 * The Map is the first tab, so it was the landing screen for an account
 * whose map has no action on it. A ONE-SHOT navigation the moment the
 * account-kind query answers "business" — never a reorder of the NativeTabs
 * triggers, whose conditional shape app-tabs.tsx records as the trap: the
 * screen list must not change between renders. One shot only, so a later
 * refetch of my_business can never yank an owner off a tab they chose; and
 * never during the listing flow, whose own replace to /business-signup must
 * not be raced (the same rule PendingInviteHandoff documents).
 */
function BusinessLanding() {
  const viewerIsBusiness = useIsBusiness();
  const listingIntent = useAuthStore((s) => s.listingIntent);
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !viewerIsBusiness || listingIntent) {
      return;
    }
    landed.current = true;
    router.navigate('/(tabs)/my-business');
  }, [viewerIsBusiness, listingIntent]);
  return null;
}

/**
 * Replays what a guest was doing when the account wall interrupted them
 * (auth store, `pendingIntent`) — the Travelers half. The map replays its
 * own two origins itself (selecting a pin card and entering place mode are
 * map state, not routes); this component lands the 'traveler' kind back on
 * the tab it came from, and clears any intent a business account cannot
 * spend. Cleared BEFORE navigating, exactly like the invite above: the
 * replayed screen can be backed out of, and a value still in the store
 * would push it straight back on.
 */
function PendingIntentHandoff() {
  const intent = useAuthStore((s) => s.pendingIntent);
  // NEVER a bare non-null session test: a guest ACCOUNT is an anonymous
  // Supabase session, so that test was true for the exact person who just
  // tapped "Make a profile" — the intent was spent (traveler kind: replayed
  // at the still-anonymous guest, mid-signup) or left to misfire. The same
  // guard the map's replay effect uses: anonymous or absent, the intent
  // WAITS in the store until a real sign-in completes and flips this false.
  const isGuest = useIsGuest();
  const intentHandled = useAuthStore((s) => s.intentHandled);
  const listingIntent = useAuthStore((s) => s.listingIntent);
  const viewerIsBusiness = useIsBusiness();

  useEffect(() => {
    if (isGuest || intent == null || listingIntent) {
      return;
    }
    if (viewerIsBusiness) {
      // A business cannot open a pin card, drop a pin, or read Travelers:
      // nothing here is spendable, so it is let go rather than replayed.
      intentHandled();
      return;
    }
    if (intent.kind !== 'traveler') {
      return;
    }
    const { userId } = intent;
    intentHandled();
    router.navigate('/(tabs)/travelers');
    // The whole promise of the gate was "Make a profile to say hi to Dev", so
    // landing on the tab is not spending the intent — for a brand-new account
    // with no trips the tab early-returns its empty state and Dev is nowhere.
    // The recorded userId is the person they came back for. A push rather
    // than a replace, and a plain screen rather than a modal, so Back lands
    // on Travelers instead of leaving the tabs.
    if (userId != null) {
      router.push(`/profile/${userId}`);
    }
  }, [isGuest, intent, listingIntent, viewerIsBusiness, intentHandled]);

  return null;
}

/**
 * Opens the sign-in door for somebody who took it from the forced-sign-out
 * notice.
 *
 * That notice is rendered INSTEAD OF the stack (see app/_layout), so there is
 * no navigator to push onto while it is up, and clearing it remounts the
 * stack at its anchor. Same shape as the invite above, and for the same
 * documented reason: park the destination, spend it at the first moment there
 * is a mounted stack. Cleared BEFORE the push, so backing out of sign-in does
 * not put it straight back on.
 */
function SignInHandoff() {
  const wanted = useAuthStore((s) => s.pendingSignIn);
  const signInHandled = useAuthStore((s) => s.signInHandled);

  useEffect(() => {
    if (!wanted) {
      return;
    }
    signInHandled();
    router.push('/email');
  }, [wanted, signInHandled]);

  return null;
}

/**
 * A tapped push opens the thing it is about. Render-nothing, mounted here
 * beside PendingInviteHandoff for exactly the reasons that component
 * documents: it needs a mounted stack and a live session, and a cold-start
 * tap read any earlier would be spent on a navigator that cannot show the
 * screen.
 */
function NotificationRouting() {
  useNotificationRouting();
  return null;
}

export default function TabsLayout() {
  // Mounted above the tabs so the moment can land wherever you happen to be
  // when the accept comes through.
  const { match, dismiss } = useAcceptedCelebration();

  return (
    <>
      <AppTabs />
      {match ? <ConnectedNotice match={match} onDismiss={dismiss} /> : null}
      {/* Mounted above the tabs for the same reason the celebration is: the
          moment that earns the question can happen on any of them. It renders
          nothing until something asks it to. */}
      <PushPrimer />
      <BusinessLanding />
      {/* ORDER IS LOAD-BEARING, and it is the arbitration between these two.
          A guest can hold an invite AND an intent at once (open a link, then
          take the Travelers gate), and both of these fire in the same commit
          on a freshly mounted stack. React runs sibling effects in order, so
          the intent goes first and spends itself selecting a TAB, and the
          invite then pushes its screen on top of it. The other way round the
          push landed first and the tab navigate popped it, which is two
          navigations racing to the top of one stack - the coin toss
          PendingInviteHandoff's own comment describes. */}
      <PendingIntentHandoff />
      <PendingInviteHandoff />
      <SignInHandoff />
      <NotificationRouting />
    </>
  );
}
