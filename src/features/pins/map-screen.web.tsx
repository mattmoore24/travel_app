import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useCityPins, useLaunchCities } from '@/features/pins/hooks';
import { intentLabel } from '@/features/pins/pin-helpers';
import { PinGlyph } from '@/features/pins/pin-marker';
import { isSupabaseConfigured } from '@/lib/supabase';

// react-native-maps has no web implementation; web is a dev convenience, so
// the map degrades to a per-city pin list there. iOS is the product.
export default function MapScreenWeb() {
  const insets = useSafeAreaInsets();
  const { data: launchCities = [] } = useLaunchCities();
  const cityId = launchCities[0]?.city_id ?? null;
  const city = launchCities.find((c) => c.city_id === cityId);
  const { data: pins = [] } = useCityPins(cityId);

  if (!isSupabaseConfigured || !city) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'map.fill', android: 'map', web: 'map' }}
        title="The Map"
        description="The map is iOS only. On web you get a list."
      />
    );
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.six, paddingBottom: BottomTabInset + Spacing.six },
        ]}>
        <ThemedText type="subtitle">Pins in {city.cities.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Web fallback list. The real map renders on iOS.
        </ThemedText>
        {pins.map((pin) => (
          <ThemedView key={pin.id} type="backgroundElement" style={styles.row}>
            <PinGlyph category={pin.category} seeded={pin.seeded} size={20} />
            <View style={styles.rowText}>
              <ThemedText type="smallBold">{pin.venue_name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {intentLabel(pin.intent_date)}
                {pin.seeded ? ' · ours' : pin.display_name ? ` · ${pin.display_name}` : ''}
              </ThemedText>
            </View>
          </ThemedView>
        ))}
        {/* Read-only on purpose: the old web composer wrote real pins at the
            city centroid with no join mode. Pin creation lives on the phone. */}
        <ThemedText type="small" themeColor="textSecondary">
          Pins are dropped from the iOS app.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
});
