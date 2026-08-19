import AppTabs from '@/components/app-tabs';
import { MatchCelebration } from '@/features/matching/match-celebration';
import { useAcceptedCelebration } from '@/features/matching/use-accepted-celebration';

export default function TabsLayout() {
  // Mounted above the tabs so the moment can land wherever you happen to be
  // when the accept comes through.
  const { match, dismiss } = useAcceptedCelebration();

  return (
    <>
      <AppTabs />
      {match ? <MatchCelebration match={match} onDismiss={dismiss} /> : null}
    </>
  );
}
