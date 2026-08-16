import { PlaceholderScreen } from '@/components/placeholder-screen';

// Surface B — trip posting and city/date-overlap matching (Phase 2).
export default function TravelersScreen() {
  return (
    <PlaceholderScreen
      icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
      title="Travelers"
      phase="coming in phase 2"
      description={
        'Post your trip and browse travelers who overlap with your city and ' +
        'dates. Send a message about something on their profile — they choose ' +
        'whether to accept.'
      }
    />
  );
}
