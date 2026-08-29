import { router } from 'expo-router';
import { useEffect } from 'react';

import AppTabs from '@/components/app-tabs';
import { useAuthStore } from '@/features/auth/store';
import { useIsBusiness } from '@/features/business/hooks';
import { ConnectedNotice } from '@/features/matching/connected-notice';
import { useAcceptedCelebration } from '@/features/matching/use-accepted-celebration';
import { PushPrimer } from '@/features/notifications/push-primer';

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
      <PendingInviteHandoff />
    </>
  );
}
