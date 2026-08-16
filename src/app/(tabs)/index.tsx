import { PlaceholderScreen } from '@/components/placeholder-screen';

// Surface A — the hero feature. Real map, intent pins, and the anonymized
// heatmap land in Phase 3; this tab leads the app from day one regardless.
export default function MapScreen() {
  return (
    <PlaceholderScreen
      icon={{ ios: 'map.fill', android: 'map', web: 'map' }}
      title="The Map"
      phase="coming in phase 3"
      description={
        'Drop a pin for where you want to go — a bar, a museum, a hike — and ' +
        'see what travelers are planning around this city today and tomorrow.'
      }
    />
  );
}
