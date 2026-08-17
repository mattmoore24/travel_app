import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PrimaryButton } from '@/components/form/primary-button';
import { AvatarButton } from '@/components/ui/avatar-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useCityPins, useDeletePin, useHeatCells, useLaunchCities } from '@/features/pins/hooks';
import { categoryEmoji, intentLabel } from '@/features/pins/pin-helpers';
import { addDays, toISODate } from '@/features/trips/dates';
import { useOwnUserId, usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import type { CityPinRow } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

const HEAT_CELL_RADIUS_M = 275;

function PinCard({
  pin,
  cityId,
  onClose,
}: {
  pin: CityPinRow;
  cityId: number;
  onClose: () => void;
}) {
  const theme = useTheme();
  const ownUserId = useOwnUserId();
  const { data: photoUrl } = usePhotoUrl(pin.photo_path);
  const deletePin = useDeletePin(cityId);
  const isOwn = pin.user_id != null && pin.user_id === ownUserId;

  return (
    <ThemedView style={styles.pinCard}>
      <View style={styles.pinCardHeader}>
        <Text style={styles.pinCardEmoji}>{categoryEmoji(pin.category, pin.seeded)}</Text>
        <View style={styles.pinCardTitle}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {pin.venue_name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {intentLabel(pin.intent_date)}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={8}>
          <SymbolView
            name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
            size={22}
            tintColor={theme.textSecondary}
          />
        </Pressable>
      </View>

      {pin.seeded ? (
        <>
          {pin.seed_note ? <ThemedText type="small">{pin.seed_note}</ThemedText> : null}
          <ThemedText type="small" themeColor="textSecondary">
            {SEEDED_LABEL}
          </ThemedText>
        </>
      ) : (
        <View style={styles.pinnerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${pin.display_name ?? 'traveler'}'s full profile`}
            onPress={() => router.push(`/profile/${pin.user_id}`)}
            style={({ pressed }) => [styles.pinnerPress, pressed && styles.pressed]}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
              ) : (
                <SymbolView
                  name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                  size={18}
                  tintColor={theme.textSecondary}
                />
              )}
            </View>
            <View style={styles.pinnerText}>
              <View style={styles.nameRow}>
                <ThemedText type="small">
                  {pin.display_name ?? 'Traveler'}
                  {pin.age != null ? `, ${pin.age}` : ''}
                </ThemedText>
                {pin.verified ? (
                  <SymbolView
                    name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
                    size={13}
                    tintColor={theme.tint}
                  />
                ) : null}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                view profile
              </ThemedText>
            </View>
          </Pressable>
          {isOwn ? (
            <PrimaryButton
              variant="danger"
              label="Remove"
              onPress={() =>
                Alert.alert('Remove this pin?', undefined, [
                  { text: 'Keep', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => {
                      deletePin.mutate(pin.id);
                      onClose();
                    },
                  },
                ])
              }
            />
          ) : (
            <PrimaryButton
              label="Say hi"
              onPress={() =>
                router.push({
                  pathname: '/compose-request',
                  params: {
                    userId: pin.user_id!,
                    name: pin.display_name ?? 'Traveler',
                    photoPath: pin.photo_path ?? '',
                    source: 'pin',
                    element: `pin:${pin.venue_name.slice(0, 50)}`,
                  },
                })
              }
            />
          )}
        </View>
      )}
    </ThemedView>
  );
}

const SEEDED_LABEL = 'Curated by the app — just show up.';

const DATE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
] as const;
type DateFilter = (typeof DATE_FILTERS)[number]['value'];

export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const { data: launchCities = [] } = useLaunchCities();
  const [cityId, setCityId] = useState<number | null>(null);
  const activeCityId = cityId ?? launchCities[0]?.city_id ?? null;
  const activeCity = launchCities.find((c) => c.city_id === activeCityId);
  // The brief's hook is "popular today/tomorrow" — the heat date dimension
  // is filterable, not blended.
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const filterISO =
    dateFilter === 'all'
      ? null
      : dateFilter === 'today'
        ? toISODate(new Date())
        : toISODate(addDays(new Date(), 1));
  const { data: allPins = [], isSuccess: pinsLoaded } = useCityPins(activeCityId);
  const { data: heat = [] } = useHeatCells(activeCityId, filterISO);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const pins = useMemo(
    () => (filterISO ? allPins.filter((p) => p.intent_date === filterISO) : allPins),
    [allPins, filterISO]
  );
  const selectedPin = useMemo(
    () => pins.find((p) => p.id === selectedPinId) ?? null,
    [pins, selectedPinId]
  );

  // §6 metrics: map DAU (every city view, including the initial one) and
  // heatmap views per session.
  useEffect(() => {
    if (activeCityId != null) {
      analytics.capture('map_viewed', { city_id: activeCityId });
    }
  }, [activeCityId]);
  useEffect(() => {
    if (activeCityId != null && heat.length > 0) {
      analytics.capture('heatmap_rendered', { city_id: activeCityId, cells: heat.length });
    }
  }, [activeCityId, heat.length]);

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'map.fill', android: 'map', web: 'map' }}
        title="The Map"
        phase="waiting on backend keys"
        description="Add Supabase keys to .env to see intent pins and the heatmap in launch cities."
      />
    );
  }

  const selectCity = (id: number) => {
    setCityId(id);
    setSelectedPinId(null);
    const city = launchCities.find((c) => c.city_id === id);
    if (city) {
      mapRef.current?.animateToRegion(
        {
          latitude: city.cities.lat,
          longitude: city.cities.lng,
          latitudeDelta: 0.09,
          longitudeDelta: 0.09,
        },
        350
      );
    }
  };

  return (
    <View style={styles.root}>
      {activeCity ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={{
            latitude: activeCity.cities.lat,
            longitude: activeCity.cities.lng,
            latitudeDelta: 0.09,
            longitudeDelta: 0.09,
          }}
          showsUserLocation={false}
          onPress={() => setSelectedPinId(null)}>
          {heat.map((cell) => (
            <Circle
              key={`${cell.cell_lat}:${cell.cell_lng}:${cell.category}`}
              center={{ latitude: cell.cell_lat, longitude: cell.cell_lng }}
              radius={HEAT_CELL_RADIUS_M}
              strokeColor="transparent"
              fillColor={`rgba(60, 135, 247, ${Math.min(0.1 + cell.pin_count * 0.06, 0.4)})`}
            />
          ))}
          {pins.map((pin) => (
            <Marker
              key={pin.id}
              coordinate={{ latitude: pin.lat, longitude: pin.lng }}
              tracksViewChanges={false}
              onPress={(event) => {
                event.stopPropagation();
                setSelectedPinId(pin.id);
                analytics.capture('pin_tapped', { seeded: pin.seeded, category: pin.category });
              }}>
              <View style={[styles.marker, { backgroundColor: theme.background }]}>
                <Text style={styles.markerEmoji}>{categoryEmoji(pin.category, pin.seeded)}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      ) : (
        <PlaceholderScreen
          icon={{ ios: 'map.fill', android: 'map', web: 'map' }}
          title="The Map"
          phase="no launch cities yet"
          description="Launch cities appear here once they're switched on."
        />
      )}

      <View style={[styles.cityBar, { top: insets.top + Spacing.two }]} pointerEvents="box-none">
        <View style={styles.headerRow} pointerEvents="box-none">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cityChips}
            style={styles.cityScroll}>
            {launchCities.map((city) => {
              const selected = city.city_id === activeCityId;
              return (
                <Pressable key={city.city_id} onPress={() => selectCity(city.city_id)}>
                  <ThemedView
                    type={selected ? 'backgroundSelected' : 'background'}
                    style={styles.cityChip}>
                    <ThemedText type={selected ? 'smallBold' : 'small'}>
                      {city.cities.name}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ScrollView>
          <AvatarButton />
        </View>
        <View style={styles.dateRow}>
          {DATE_FILTERS.map((filter) => {
            const selected = filter.value === dateFilter;
            return (
              <Pressable key={filter.value} onPress={() => setDateFilter(filter.value)}>
                <ThemedView
                  type={selected ? 'backgroundSelected' : 'background'}
                  style={styles.dateChip}>
                  <ThemedText type={selected ? 'smallBold' : 'small'}>{filter.label}</ThemedText>
                </ThemedView>
              </Pressable>
            );
          })}
        </View>
      </View>

      {activeCity && pinsLoaded && pins.length === 0 && !selectedPin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Be the first to drop a pin"
          onPress={() =>
            router.push({ pathname: '/drop-pin', params: { cityId: activeCity.city_id } })
          }
          style={[
            styles.emptyBanner,
            { bottom: BottomTabInset + insets.bottom + Spacing.five + 64 },
          ]}>
          <ThemedView style={styles.emptyCard}>
            <ThemedText type="smallBold">
              {dateFilter === 'all'
                ? `No pins in ${activeCity.cities.name} yet`
                : `Nothing pinned for ${dateFilter} yet`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Be the first — drop a pin where you&apos;re headed and travelers here will see it.
            </ThemedText>
          </ThemedView>
        </Pressable>
      ) : null}

      {activeCity && !selectedPin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Drop a pin"
          onPress={() =>
            router.push({ pathname: '/drop-pin', params: { cityId: activeCity.city_id } })
          }
          style={[
            styles.fab,
            { backgroundColor: theme.tint, bottom: BottomTabInset + insets.bottom + Spacing.five },
          ]}>
          <SymbolView
            name={{ ios: 'plus', android: 'add', web: 'add' }}
            size={22}
            tintColor={theme.onTint}
          />
          <Text style={[styles.fabLabel, { color: theme.onTint }]}>Drop a pin</Text>
        </Pressable>
      ) : null}

      {selectedPin && activeCityId != null ? (
        <View style={[styles.cardWrap, { bottom: BottomTabInset + insets.bottom + Spacing.four }]}>
          <PinCard pin={selectedPin} cityId={activeCityId} onClose={() => setSelectedPinId(null)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  cityBar: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  cityChips: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  cityChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  dateRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  dateChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  pinnerPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  marker: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  markerEmoji: {
    fontSize: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingRight: Spacing.three,
  },
  cityScroll: {
    flex: 1,
  },
  emptyBanner: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
  },
  emptyCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  fab: {
    position: 'absolute',
    right: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    height: 48,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  fabLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardWrap: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
  },
  pinCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pinCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  pinCardEmoji: {
    fontSize: 22,
  },
  pinCardTitle: {
    flex: 1,
    gap: 1,
  },
  pinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  pinnerText: {
    flex: 1,
    gap: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
