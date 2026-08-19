import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useCityPins, useLaunchCities } from '@/features/pins/hooks';
import { categoryEmoji, intentLabel } from '@/features/pins/pin-helpers';
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
        phase="native map on iOS"
        description="The interactive map renders on the phone. On web (dev), pins show as a list once Supabase keys exist."
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
            <Text style={styles.emoji}>{categoryEmoji(pin.category, pin.seeded)}</Text>
            <View style={styles.rowText}>
              <ThemedText type="smallBold">{pin.venue_name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {intentLabel(pin.intent_date)}
                {pin.seeded ? ' · curated' : pin.display_name ? ` · ${pin.display_name}` : ''}
              </ThemedText>
            </View>
          </ThemedView>
        ))}
        <PrimaryButton
          label="Drop a pin"
          onPress={() => router.push({ pathname: '/drop-pin', params: { cityId: city.city_id } })}
        />
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
    borderRadius: Spacing.three,
  },
  emoji: {
    fontSize: 20,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
});
