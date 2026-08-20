import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import Animated, { FadeInDown, FadeInUp, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PrimaryButton } from '@/components/form/primary-button';
import { AvatarButton } from '@/components/ui/avatar-button';
import { GlassSurface } from '@/components/ui/glass-surface';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, HitTarget, Motion, Radius, Space, Spacing } from '@/constants/theme';
import { useDeletePin, useLaunchCities } from '@/features/pins/hooks';
import { useIsGuest, useMapHeat, useMapPins } from '@/features/guest/hooks';
import {
  MARKER_ANCHOR,
  MARKER_CENTER_OFFSET,
  PinMarkerView,
  useMarkerTracking,
} from '@/features/pins/pin-marker';
import { PinFormSheet } from '@/features/pins/pin-form-sheet';
import { PinSearchField } from '@/features/pins/pin-search-field';
import { PlacePinOverlay } from '@/features/pins/place-pin-overlay';
import { burnOutLabel, categoryEmoji, intentLabel } from '@/features/pins/pin-helpers';
import { addDays, toISODate } from '@/features/trips/dates';
import { useOwnUserId, usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
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

  // This card lives inside a Sheet, which is a Modal. Navigating out from
  // under a presented modal leaves its full-screen scrim alive above the map:
  // the profile opens, you come back, and every tap afterwards lands on an
  // invisible overlay instead of the map. It reads as a total freeze. So the
  // sheet is dismissed FIRST and the push waits for it to finish leaving.
  const leaveThen = (go: () => void) => {
    onClose();
    setTimeout(go, SHEET_EXIT_MS);
  };

  return (
    <ThemedView style={styles.pinCard}>
      <View style={styles.pinCardHeader}>
        <Text style={styles.pinCardEmoji}>{categoryEmoji(pin.category, pin.seeded)}</Text>
        <View style={styles.pinCardTitle}>
          <ThemedText type="headline" numberOfLines={1}>
            {pin.venue_name}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {intentLabel(pin.intent_date)} · {burnOutLabel(pin.expires_at)}
          </ThemedText>
          {pin.place_label ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
              {pin.place_label}
            </ThemedText>
          ) : null}
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

      {pin.note ? <ThemedText type="body">{pin.note}</ThemedText> : null}

      {pin.seeded ? (
        <>
          {pin.seed_note ? <ThemedText type="body">{pin.seed_note}</ThemedText> : null}
          <ThemedText type="footnote" themeColor="textSecondary">
            {SEEDED_LABEL}
          </ThemedText>
        </>
      ) : (
        <>
          {/* Tap the person to read them properly before deciding. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`View ${pin.display_name ?? 'traveler'}'s profile`}
            scaleTo={0.98}
            haptic="soft"
            onPress={() => leaveThen(() => router.push(`/profile/${pin.user_id}`))}>
            <ThemedView type="surfaceSunken" style={styles.pinnerCard}>
              <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
                ) : (
                  <SymbolView
                    name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                    size={20}
                    tintColor={theme.textSecondary}
                  />
                )}
              </View>
              <View style={styles.pinnerText}>
                <View style={styles.nameRow}>
                  <ThemedText type="callout" style={styles.strong}>
                    {pin.display_name ?? 'Traveler'}
                    {pin.age != null ? `, ${pin.age}` : ''}
                  </ThemedText>
                  {pin.verified ? (
                    <SymbolView
                      name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
                      size={13}
                      tintColor={theme.accent}
                    />
                  ) : null}
                </View>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Tap to see their profile
                </ThemedText>
              </View>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={14}
                tintColor={theme.textSecondary}
              />
            </ThemedView>
          </PressableScale>

          {isOwn ? (
            <PrimaryButton
              variant="danger"
              label="Take this pin down"
              onPress={() =>
                Alert.alert('Take this pin down?', undefined, [
                  { text: 'Keep it', style: 'cancel' },
                  {
                    text: 'Take it down',
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
            <>
              <PrimaryButton
                label="Ask about this plan"
                onPress={() =>
                  leaveThen(() =>
                    router.push({
                      pathname: '/compose-request',
                      params: {
                        userId: pin.user_id!,
                        name: pin.display_name ?? 'Traveler',
                        photoPath: pin.photo_path ?? '',
                        source: 'pin',
                        element: `pin:${pin.venue_name.slice(0, 50)}`,
                        // Opens with the question already written, because
                        // "what do I even say" is what stops most people.
                        draft: `Hey! I would like more details on your plans at ${
                          pin.place_label ?? pin.venue_name
                        }.`,
                      },
                    })
                  )
                }
              />
            </>
          )}
        </>
      )}
    </ThemedView>
  );
}

/**
 * How long to let a Sheet finish leaving before navigating out from under it.
 * The exit animation is 200ms (components/ui/sheet.tsx); the margin covers a
 * busy frame, and the cost of being generous is imperceptible.
 */
const SHEET_EXIT_MS = 320;

const SEEDED_LABEL = 'One of our picks. Just show up.';

const DATE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
] as const;
type DateFilter = (typeof DATE_FILTERS)[number]['value'];

/** One marker, so each pin manages its own rasterization window. */
function CityPinMarker({
  pin,
  selected,
  onPress,
}: {
  pin: CityPinRow;
  selected: boolean;
  onPress: () => void;
}) {
  // Signed-in viewers see the poster's face on the map; a guest's feed has no
  // photo_path at all (server-stripped), so this simply resolves to nothing.
  const { data: photoUri } = usePhotoUrl(pin.photo_path);
  const tracking = useMarkerTracking(`${selected}:${photoUri ?? ''}`);
  return (
    <Marker
      coordinate={{ latitude: pin.lat, longitude: pin.lng }}
      anchor={MARKER_ANCHOR}
      centerOffset={MARKER_CENTER_OFFSET}
      // Real traveler pins must never be hidden by Apple Maps' collision
      // pass; curated seeds may yield to them in a crowd.
      displayPriority={pin.seeded ? 'high' : 'required'}
      zIndex={selected ? 10 : 1}
      tracksViewChanges={tracking}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}>
      <PinMarkerView
        category={pin.category}
        seeded={pin.seeded}
        selected={selected}
        photoUri={photoUri ?? null}
      />
    </Marker>
  );
}

type MapMode = 'browse' | 'place' | 'detail';

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
  const { data: allPins = [], isSuccess: pinsLoaded } = useMapPins(activeCityId);
  const { data: heat = [] } = useMapHeat(activeCityId, filterISO);
  const isGuest = useIsGuest();
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  // The drop-a-pin flow lives on this map, not a separate screen: browse →
  // place (map pans under a fixed pin) → detail (form sheet over the map).
  const [mode, setMode] = useState<MapMode>('browse');
  const [lifted, setLifted] = useState(false);
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [searchedVenue, setSearchedVenue] = useState('');
  const lastRegion = useRef<Region | null>(null);

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
        description="Add Supabase keys to .env to see pins and the heat layer in launch cities."
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

  const enterPlaceMode = () => {
    if (isGuest) {
      router.push('/join');
      return;
    }
    if (!activeCity) {
      return;
    }
    haptics.light();
    setSelectedPinId(null);
    setSearchedVenue('');
    const region = lastRegion.current;
    setPlaceCoords({
      lat: region?.latitude ?? activeCity.cities.lat,
      lng: region?.longitude ?? activeCity.cities.lng,
    });
    setMode('place');
    // Zoom in a step: placement wants street precision, browsing wants area.
    mapRef.current?.animateToRegion(
      {
        latitude: region?.latitude ?? activeCity.cities.lat,
        longitude: region?.longitude ?? activeCity.cities.lng,
        latitudeDelta: Math.min(region?.latitudeDelta ?? 0.09, 0.09) / 3,
        longitudeDelta: Math.min(region?.longitudeDelta ?? 0.09, 0.09) / 3,
      },
      Motion.slow
    );
  };

  const exitPlaceMode = () => {
    setMode('browse');
    setLifted(false);
  };

  const flyTo = (coords: { lat: number; lng: number }, venue: string) => {
    setSearchedVenue(venue);
    setPlaceCoords(coords);
    mapRef.current?.animateToRegion(
      {
        latitude: coords.lat,
        longitude: coords.lng,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      },
      Motion.slow
    );
  };

  const placing = mode === 'place' || mode === 'detail';

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
          scrollEnabled={mode !== 'detail'}
          onPress={() => {
            if (mode === 'browse') {
              setSelectedPinId(null);
            }
          }}
          onRegionChange={() => {
            if (mode === 'place') {
              setLifted(true);
            }
          }}
          onRegionChangeComplete={(region) => {
            lastRegion.current = region;
            if (mode === 'place') {
              setLifted(false);
              setPlaceCoords({ lat: region.latitude, lng: region.longitude });
            }
          }}>
          {heat.map((cell) => (
            <Circle
              key={`${cell.cell_lat}:${cell.cell_lng}:${cell.category}`}
              center={{ latitude: cell.cell_lat, longitude: cell.cell_lng }}
              radius={HEAT_CELL_RADIUS_M}
              strokeColor="transparent"
              fillColor={`rgba(42, 76, 155, ${Math.min(0.08 + cell.pin_count * 0.05, 0.32)})`}
            />
          ))}
          {pins.map((pin) => (
            <CityPinMarker
              key={pin.id}
              pin={pin}
              selected={pin.id === selectedPinId}
              onPress={() => {
                // Guard doubles: marker onPress can fire twice on iOS.
                if (placing || pin.id === selectedPinId) {
                  return;
                }
                haptics.light();
                setSelectedPinId(pin.id);
                // Nudge the camera so the pin stays visible above the sheet.
                const delta = lastRegion.current?.latitudeDelta ?? 0.05;
                mapRef.current?.animateToRegion(
                  {
                    latitude: pin.lat - delta * 0.12,
                    longitude: pin.lng,
                    latitudeDelta: delta,
                    longitudeDelta: lastRegion.current?.longitudeDelta ?? delta,
                  },
                  300
                );
                analytics.capture('pin_tapped', { seeded: pin.seeded, category: pin.category });
              }}
            />
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

      {/* Fixed centre pin the map pans underneath while placing. */}
      {placing ? <PlacePinOverlay lifted={lifted} /> : null}

      {/* No entering animation on the browse chrome: on the new architecture
          an ancestor mid-entering can hit-test against a stale rect, and
          "first tap after landing on the map" is exactly the moment users
          reach for these controls. */}
      {mode === 'browse' ? (
        <View style={[styles.cityBar, { top: insets.top + Spacing.two }]} pointerEvents="box-none">
          <View style={styles.headerRow} pointerEvents="box-none">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.cityChips}
              style={styles.cityScroll}>
              {launchCities.map((city) => {
                const selected = city.city_id === activeCityId;
                return (
                  <PressableScale
                    key={city.city_id}
                    haptic="selection"
                    scaleTo={0.94}
                    onPress={() => selectCity(city.city_id)}>
                    <ThemedView
                      type={selected ? 'backgroundSelected' : 'background'}
                      style={styles.cityChip}>
                      <ThemedText type={selected ? 'smallBold' : 'small'}>
                        {city.cities.name}
                      </ThemedText>
                    </ThemedView>
                  </PressableScale>
                );
              })}
            </ScrollView>
            <AvatarButton />
          </View>
          <View style={styles.dateRow}>
            {DATE_FILTERS.map((filter) => {
              const selected = filter.value === dateFilter;
              return (
                <PressableScale
                  key={filter.value}
                  haptic="selection"
                  scaleTo={0.94}
                  onPress={() => setDateFilter(filter.value)}>
                  <GlassSurface
                    variant="clear"
                    tinted={selected}
                    radius={Radius.pill}
                    pointerEvents="none">
                    <View style={styles.dateChip}>
                      <ThemedText
                        type="footnote"
                        style={selected ? styles.chipSelected : undefined}>
                        {filter.label}
                      </ThemedText>
                    </View>
                  </GlassSurface>
                </PressableScale>
              );
            })}
          </View>
        </View>
      ) : null}

      {mode === 'place' ? (
        <Animated.View
          entering={FadeInDown.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.cityBar, { top: insets.top + Spacing.two }]}
          pointerEvents="box-none">
          <View style={styles.headerRow} pointerEvents="box-none">
            <View style={styles.searchWrap}>
              <PinSearchField
                cityName={activeCity?.cities.name ?? ''}
                cityLat={activeCity?.cities.lat ?? 0}
                cityLng={activeCity?.cities.lng ?? 0}
                onFound={flyTo}
              />
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Cancel pin placement"
              hitSlop={8}
              scaleTo={0.9}
              haptic="soft"
              onPress={exitPlaceMode}>
              <GlassSurface
                variant="clear"
                radius={Radius.pill}
                pointerEvents="none"
                style={styles.cancelButton}>
                <SymbolView
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  size={16}
                  tintColor={theme.text}
                />
              </GlassSurface>
            </PressableScale>
          </View>
        </Animated.View>
      ) : null}

      {activeCity && mode === 'browse' && pinsLoaded && pins.length === 0 && !selectedPin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Be the first to drop a pin"
          onPress={enterPlaceMode}
          style={[
            styles.emptyBanner,
            { bottom: BottomTabInset + insets.bottom + Spacing.five + 64 },
          ]}>
          <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
            <ThemedText type="smallBold">
              {dateFilter === 'all'
                ? `No pins in ${activeCity.cities.name} yet`
                : `Nothing pinned for ${dateFilter} yet`}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              Be the first. Drop a pin for what you are up to and people here will see it.
            </ThemedText>
          </GlassSurface>
        </Pressable>
      ) : null}

      {activeCity && mode === 'browse' && !selectedPin ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.dock, { bottom: BottomTabInset + insets.bottom + Space.sm }]}
          pointerEvents="box-none">
          {/* The one warm-accent action on the screen: amber belongs to the
              moments that light a fire, and this is the app's core act. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Drop a pin"
            scaleTo={0.95}
            haptic="light"
            onPress={enterPlaceMode}
            style={[styles.dockButton, { backgroundColor: theme.highlight }]}>
            <SymbolView
              name={{ ios: 'mappin.and.ellipse', android: 'add_location', web: 'add_location' }}
              size={19}
              tintColor={theme.onHighlight}
            />
            <Text style={[styles.dockLabel, { color: theme.onHighlight }]}>Drop a pin</Text>
          </PressableScale>
        </Animated.View>
      ) : null}

      {mode === 'place' ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.dock, { bottom: BottomTabInset + insets.bottom + Space.sm }]}
          pointerEvents="box-none">
          <View style={styles.confirmBar}>
            <PrimaryButton
              label="Pin here"
              disabled={placeCoords == null || lifted}
              onPress={() => {
                haptics.light();
                setMode('detail');
              }}
            />
          </View>
        </Animated.View>
      ) : null}

      {mode === 'detail' && activeCity && placeCoords ? (
        <PinFormSheet
          cityId={activeCity.city_id}
          cityName={activeCity.cities.name}
          coords={placeCoords}
          initialVenue={searchedVenue}
          onClose={() => setMode('place')}
          onPosted={(pinId) => {
            setMode('browse');
            setLifted(false);
            // Sheets are presented as modals, and iOS silently drops a
            // presentation that begins while another modal is still
            // dismissing — which left a freshly dropped pin with no
            // confirmation card at all. Wait for the form to finish leaving,
            // then select it (the card also needs the refetched row).
            setTimeout(() => setSelectedPinId(pinId), 450);
          }}
        />
      ) : null}

      {mode === 'browse' && selectedPin && activeCityId != null ? (
        <Sheet onClose={() => setSelectedPinId(null)}>
          {isGuest && !selectedPin.seeded ? (
            <SignUpGate reason="See who's going and say hi" cta="Create an account" compact />
          ) : (
            <PinCard
              pin={selectedPin}
              cityId={activeCityId}
              onClose={() => setSelectedPinId(null)}
            />
          )}
        </Sheet>
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
  chipSelected: {
    fontWeight: '600',
  },
  cityChip: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
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
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
  },
  searchWrap: {
    flex: 1,
    paddingLeft: Spacing.three,
  },
  cancelButton: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
  },
  strong: {
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
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
    padding: Space.lg,
    gap: Space.xs,
  },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  dockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    height: 52,
    paddingHorizontal: Space.xl,
    borderRadius: Radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  dockLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBar: {
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.four,
  },
  pinCard: {
    gap: Space.md,
    backgroundColor: 'transparent',
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
