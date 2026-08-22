import AppTabs from '@/components/app-tabs';
import { ConnectedNotice } from '@/features/matching/connected-notice';
import { useAcceptedCelebration } from '@/features/matching/use-accepted-celebration';
import { PushPrimer } from '@/features/notifications/push-primer';

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
    </>
  );
}
