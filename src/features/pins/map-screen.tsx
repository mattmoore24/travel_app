import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Circle, Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import Animated, { FadeInDown, FadeInUp, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PrimaryButton } from '@/components/form/primary-button';
import { AvatarButton } from '@/components/ui/avatar-button';
import { GlassSurface } from '@/components/ui/glass-surface';
import { PressableScale } from '@/components/ui/pressable-scale';
import { LoadError } from '@/components/ui/load-error';
import { Sheet, leavingSheet } from '@/components/ui/sheet';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, HitTarget, Motion, Radius, Space, Spacing } from '@/constants/theme';
import { useDeletePin, useLaunchCities } from '@/features/pins/hooks';
import { useIsGuest, useMapHeat, useMapPins } from '@/features/guest/hooks';
import {
  CITY_ZOOM_DELTA,
  clusterPins,
  clusterTitle,
  metersBetween,
  type PinCluster,
} from '@/features/pins/cluster';
import { heatRings, mergeHeatCells } from '@/features/pins/heat';
import { useHeatLegend } from '@/features/pins/heat-legend';
import {
  MARKER_ANCHOR,
  MARKER_CENTER_OFFSET,
  PinGlyph,
  PinMarkerView,
  PinStackView,
  useMarkerTracking,
} from '@/features/pins/pin-marker';
import { openInMaps } from '@/features/pins/open-in-maps';
import { PinFormSheet } from '@/features/pins/pin-form-sheet';
import { PinSearchField } from '@/features/pins/pin-search-field';
import type { LocalSearchResult } from '@/modules/local-search';
import { PlacePinOverlay } from '@/features/pins/place-pin-overlay';
import { burnOutLabel, intentLabel } from '@/features/pins/pin-helpers';
import { addDays, toISODate } from '@/features/trips/dates';
import { useOwnUserId, usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import type { CityPinRow } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

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

  // This card lives inside a Sheet, which is a Modal, so every push from here
  // has to leave the sheet first. See components/ui/sheet for why.
  const leaveThen = leavingSheet(onClose);

  return (
    <ThemedView style={styles.pinCard}>
      <View style={styles.pinCardHeader}>
        {/* The same disc and glyph as the marker you just tapped, so the
            card reads as that pin opening rather than a new object. Your own
            pin gets the celebration spring: dropping one is the affirming
            act on this screen and it deserves a beat. */}
        <Animated.View
          entering={isOwn ? ZoomIn.springify().duration(550).dampingRatio(0.75) : undefined}>
          <PinGlyph category={pin.category} seeded={pin.seeded} />
        </Animated.View>
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
          {/* Getting there is somebody else's job, and the phone already has
              an app for it. */}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`View ${pin.venue_name} in Maps`}
            hitSlop={8}
            onPress={() =>
              openInMaps({ lat: pin.lat, lng: pin.lng, label: pin.place_label ?? pin.venue_name })
            }
            style={styles.mapsLink}>
            <SymbolView
              name={{ ios: 'map', android: 'map', web: 'map' }}
              size={13}
              tintColor={theme.accent}
            />
            <ThemedText type="footnote" themeColor="accent">
              View in Maps
            </ThemedText>
          </Pressable>
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
            onPress={() =>
              leaveThen(() =>
                router.push({
                  pathname: '/profile/[userId]',
                  // Carried so a reply started from this profile is sent as a
                  // pin request. A pinner does not have to share your dates.
                  params: { userId: pin.user_id!, from: 'pin' },
                })
              )
            }>
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
                    <VerifiedSeal size={13} name={pin.display_name} age={pin.age} />
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
            // Your own pin, which is a thing you just DID, not a thing to
            // undo. It used to climax in a red delete button: the one
            // affirming act on the map ended on the most alarming control in
            // the app. Now the pin says what it is and when it burns out,
            // Done is the action, and taking it down is a quiet footnote.
            <>
              <ThemedText type="footnote" themeColor="textSecondary">
                Your pin · {burnOutLabel(pin.expires_at)}
              </ThemedText>
              <PrimaryButton label="Done" onPress={onClose} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take this pin down"
                hitSlop={10}
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
                }>
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.takeDown}>
                  Take it down early
                </ThemedText>
              </Pressable>
            </>
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

const SEEDED_LABEL = 'One of our picks. Just show up.';

/**
 * How far the map centre can drift from a searched place before the pin
 * stops being about that place. Roughly a venue's own footprint.
 */
const PLACE_DRIFT_M = 40;

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
      // Without these the map — the app's hero screen — has no content at
      // all under VoiceOver: every pin is an unlabelled image.
      accessibilityRole="button"
      accessibilityLabel={[
        pin.venue_name,
        pin.display_name,
        intentLabel(pin.intent_date),
        burnOutLabel(pin.expires_at),
      ]
        .filter(Boolean)
        .join(', ')}
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

/**
 * Several plans at one venue, as one marker. Three faces at most, then a
 * count — the faces are the reason to tap, and a bare number is not.
 *
 * Exactly three photo lookups every render, whatever the cluster holds, so
 * the hook count cannot change under React.
 */
function ClusterMarker({
  cluster,
  selected,
  onPress,
}: {
  cluster: PinCluster;
  selected: boolean;
  onPress: () => void;
}) {
  const first = usePhotoUrl(cluster.pins[0]?.photo_path ?? null);
  const second = usePhotoUrl(cluster.pins[1]?.photo_path ?? null);
  const third = usePhotoUrl(cluster.pins[2]?.photo_path ?? null);
  const faces = [first.data ?? null, second.data ?? null, third.data ?? null].slice(
    0,
    Math.min(3, cluster.pins.length)
  );
  const tracking = useMarkerTracking(`${selected}:${faces.join('|')}`);
  return (
    <Marker
      coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
      anchor={MARKER_ANCHOR}
      centerOffset={MARKER_CENTER_OFFSET}
      displayPriority="required"
      zIndex={selected ? 10 : 2}
      tracksViewChanges={tracking}
      accessibilityRole="button"
      accessibilityLabel={`${clusterTitle(cluster)}, ${cluster.pins.length} plans`}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}>
      <PinStackView
        faces={faces}
        count={cluster.pins.length}
        category={cluster.pins[0].category}
        selected={selected}
      />
    </Marker>
  );
}

type MapMode = 'browse' | 'place' | 'detail';

export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const launchCitiesQuery = useLaunchCities();
  const launchCities = launchCitiesQuery.data ?? [];
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
  const heatCells = useMemo(() => mergeHeatCells(heat), [heat]);
  const legend = useHeatLegend(heatCells.length > 0);
  const isGuest = useIsGuest();
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  // Every other gate in the app states its reason before it asks. Dropping a
  // pin was the one that did not: it teleported a guest to an email form with
  // no explanation of what had just happened to them.
  const [pinGate, setPinGate] = useState(false);
  // Which stack of plans is open, if any. Separate from selectedPinId: a
  // stack is a list of plans, and picking one out of it opens the pin card.
  const [venueKey, setVenueKey] = useState<string | null>(null);
  // Past city scale, individual venues are smaller than a fingertip, so the
  // whole city becomes one marker with a count. Held as state rather than in
  // the region ref because it has to repaint — but it only ever changes when
  // the threshold is crossed, not on every frame of a pinch.
  const [cityScale, setCityScale] = useState(false);

  // The drop-a-pin flow lives on this map, not a separate screen: browse →
  // place (map pans under a fixed pin) → detail (form sheet over the map).
  const [mode, setMode] = useState<MapMode>('browse');
  const [lifted, setLifted] = useState(false);
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [searchedPlace, setSearchedPlace] = useState<LocalSearchResult | null>(null);
  const lastRegion = useRef<Region | null>(null);

  const pins = useMemo(
    () => (filterISO ? allPins.filter((p) => p.intent_date === filterISO) : allPins),
    [allPins, filterISO]
  );
  const selectedPin = useMemo(
    () => pins.find((p) => p.id === selectedPinId) ?? null,
    [pins, selectedPinId]
  );
  // Plans at one venue become one marker. At launch density — everybody
  // pinning the same handful of bars — three markers on one building meant
  // two of them were literally under the third and could not be tapped.
  const clusters = useMemo(() => clusterPins(pins), [pins]);
  const openVenue = useMemo(
    () => clusters.find((cluster) => cluster.key === venueKey) ?? null,
    [clusters, venueKey]
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
      setPinGate(true);
      return;
    }
    if (!activeCity) {
      return;
    }
    haptics.light();
    setSelectedPinId(null);
    setSearchedPlace(null);
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

  const flyTo = (place: LocalSearchResult) => {
    setSearchedPlace(place);
    setPlaceCoords({ lat: place.latitude, lng: place.longitude });
    mapRef.current?.animateToRegion(
      {
        latitude: place.latitude,
        longitude: place.longitude,
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
              setVenueKey(null);
            }
          }}
          onRegionChange={() => {
            if (mode === 'place') {
              setLifted(true);
            }
          }}
          onRegionChangeComplete={(region) => {
            lastRegion.current = region;
            // Only flips at the threshold, so this is not a per-frame render.
            setCityScale(region.latitudeDelta > CITY_ZOOM_DELTA);
            if (mode === 'place') {
              setLifted(false);
              setPlaceCoords({ lat: region.latitude, lng: region.longitude });
              // Drag away from the place you searched for and it stops being
              // that place. Without this the form would fill itself in with
              // the address of a venue the pin is no longer on. The fly-to
              // animation lands within metres of the target, so it survives.
              setSearchedPlace((place) =>
                place != null &&
                metersBetween(place.latitude, place.longitude, region.latitude, region.longitude) >
                  PLACE_DRIFT_M
                  ? null
                  : place
              );
            }
          }}>
          {/* Merged across categories, then drawn as three concentric rings
              per cell so the glow falls off instead of ending at a hard
              boundary. See features/pins/heat.ts for both. */}
          {heatCells.map((cell) =>
            heatRings(cell).map((ring) => (
              <Circle
                key={ring.key}
                center={{ latitude: cell.lat, longitude: cell.lng }}
                radius={ring.radius}
                strokeColor="transparent"
                fillColor={ring.fill}
              />
            ))
          )}
          {/* One marker per city once the map is zoomed past street scale:
              at that size every venue is smaller than a fingertip, and a
              hundred overlapping pins say less than one number does. */}
          {cityScale && activeCity && pins.length > 0 ? (
            <Marker
              coordinate={{ latitude: activeCity.cities.lat, longitude: activeCity.cities.lng }}
              anchor={MARKER_ANCHOR}
              centerOffset={MARKER_CENTER_OFFSET}
              accessibilityRole="button"
              accessibilityLabel={`${pins.length} plans in ${activeCity.cities.name}`}
              onPress={(event) => {
                event.stopPropagation();
                haptics.light();
                mapRef.current?.animateToRegion(
                  {
                    latitude: activeCity.cities.lat,
                    longitude: activeCity.cities.lng,
                    latitudeDelta: 0.09,
                    longitudeDelta: 0.09,
                  },
                  350
                );
              }}>
              <PinStackView faces={[null]} count={pins.length} category={pins[0].category} />
            </Marker>
          ) : null}

          {!cityScale &&
            clusters
              .filter((cluster) => cluster.pins.length > 1)
              .map((cluster) => (
                <ClusterMarker
                  key={cluster.key}
                  cluster={cluster}
                  selected={cluster.key === venueKey}
                  onPress={() => {
                    if (placing || cluster.key === venueKey) {
                      return;
                    }
                    haptics.light();
                    setSelectedPinId(null);
                    setVenueKey(cluster.key);
                  }}
                />
              ))}

          {!cityScale &&
            clusters
              .filter((cluster) => cluster.pins.length === 1)
              .map(({ pins: [pin] }) => (
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
                    setVenueKey(null);
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
        <ThemedView style={StyleSheet.absoluteFill}>
          {launchCitiesQuery.isError ? (
            // The hero screen used to answer a FAILED query with a dev phase
            // badge reading "no launch cities yet" — an internal note shown
            // to somebody in an airport with bad wifi.
            <LoadError
              what="the map"
              error={launchCitiesQuery.error}
              onRetry={() => launchCitiesQuery.refetch()}
            />
          ) : launchCitiesQuery.isSuccess ? (
            <PlaceholderScreen
              icon={{ ios: 'map.fill', android: 'map', web: 'map' }}
              title="The Map"
              phase="no launch cities yet"
              description="Launch cities appear here once they're switched on."
            />
          ) : null}
        </ThemedView>
      )}

      {/* A ground for the status bar. Apple's basemap draws street and
          district labels right to the top edge, so the clock, the carrier
          and the battery sat in a field of small type they collided with.
          Inert to touch, and it stops well before the chips. */}
      <LinearGradient
        colors={[theme.background, 'transparent']}
        locations={[0, 0.55]}
        style={[styles.statusScrim, { height: insets.top + Spacing.six }]}
        pointerEvents="none"
      />

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
                    accessibilityRole="button"
                    accessibilityLabel={city.cities.name}
                    accessibilityState={{ selected }}
                    hitSlop={4}
                    haptic="selection"
                    scaleTo={0.94}
                    onPress={() => selectCity(city.city_id)}>
                    <View
                      style={[
                        styles.cityChip,
                        {
                          backgroundColor: selected ? theme.accent : theme.surface,
                          borderColor: selected ? 'transparent' : theme.hairline,
                        },
                      ]}>
                      {/* One size, whichever is selected. 'smallBold' is a
                          bigger role (15pt) as well as a heavier one, so
                          tapping a chip used to reflow the whole rail and
                          shove its neighbours sideways under your thumb. */}
                      <ThemedText
                        type="small"
                        style={selected ? { color: theme.onAccent, fontWeight: '700' } : undefined}>
                        {city.cities.name}
                      </ThemedText>
                    </View>
                  </PressableScale>
                );
              })}
            </ScrollView>
            {/* The rail runs under the avatar button, so the last chip used
                to be cut in half by it: "Mexico City" read as "Me…". The
                padding gives the rail somewhere to end and the fade says
                "there is more this way" instead of "this word is broken". */}
            <LinearGradient
              colors={['transparent', theme.background]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.railFade}
              pointerEvents="none"
            />
            <AvatarButton />
          </View>
          <View style={styles.dateRow}>
            {DATE_FILTERS.map((filter) => {
              const selected = filter.value === dateFilter;
              return (
                <PressableScale
                  key={filter.value}
                  accessibilityRole="button"
                  accessibilityLabel={filter.label}
                  accessibilityState={{ selected }}
                  // The chip is drawn at 30pt on purpose, over a map that
                  // needs the room. The target is 44.
                  hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
                  haptic="selection"
                  scaleTo={0.94}
                  onPress={() => setDateFilter(filter.value)}>
                  {/* Selection means the same thing on both rails: accent
                      fill, ink on top. The date chips used to say it in a
                      third language (soft fill, accent border), so two rows
                      eight points apart disagreed about what "on" looks
                      like. */}
                  <View
                    style={[
                      styles.dateChip,
                      {
                        backgroundColor: selected ? theme.accent : theme.surface,
                        borderColor: selected ? 'transparent' : theme.hairline,
                      },
                    ]}>
                    <ThemedText
                      type="footnote"
                      style={selected ? { color: theme.onAccent, fontWeight: '700' } : undefined}>
                      {filter.label}
                    </ThemedText>
                  </View>
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
          {/* Blue, not amber. Amber now belongs to the pins themselves, and
              two warm things on one screen means neither reads as the
              signal. Controls are the brand blue; the map's content is warm. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Drop a pin"
            scaleTo={0.95}
            haptic="light"
            onPress={enterPlaceMode}
            style={[styles.dockButton, { backgroundColor: theme.accent }]}>
            <SymbolView
              name={{ ios: 'mappin.and.ellipse', android: 'add_location', web: 'add_location' }}
              size={19}
              tintColor={theme.onAccent}
            />
            <Text style={[styles.dockLabel, { color: theme.onAccent }]}>Drop a pin</Text>
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
          initialPlace={searchedPlace}
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

      {/* The heat layer is the only thing on this map with no label, no
          marker and nothing to tap, so the first time somebody sees it they
          have to guess. One sentence, once. */}
      {legend.visible && mode === 'browse' ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[
            styles.legend,
            { bottom: BottomTabInset + insets.bottom + Space.xxxl + Space.xl },
          ]}
          pointerEvents="box-none">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Glowing spots are plans nearby. Tap to dismiss."
            scaleTo={0.96}
            haptic="light"
            onPress={legend.dismiss}>
            <View
              style={[
                styles.legendChip,
                { backgroundColor: theme.surface, borderColor: theme.hairline },
              ]}>
              <View style={[styles.legendDot, { backgroundColor: 'rgba(255, 154, 90, 0.85)' }]} />
              <ThemedText type="footnote">Glowing spots are plans nearby</ThemedText>
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={11}
                tintColor={theme.textSecondary}
              />
            </View>
          </PressableScale>
        </Animated.View>
      ) : null}

      {pinGate ? (
        <Sheet onClose={() => setPinGate(false)}>
          <SignUpGate
            reason="Dropping a pin needs a profile, so people know who is going"
            cta="Make a profile"
            compact
            // Pushing a route from inside a sheet leaves its scrim over the
            // map and every later tap lands on nothing. See components/ui/sheet.
            onNavigate={leavingSheet(() => setPinGate(false))}
          />
        </Sheet>
      ) : null}

      {/* A stack of plans, opened. Same non-modal treatment as the pin card
          below: the map stays live, so tapping a different venue swaps this
          for that one. */}
      {mode === 'browse' && openVenue && activeCityId != null ? (
        <Sheet inline dimmed={false} onClose={() => setVenueKey(null)}>
          <View style={styles.venueHeader}>
            <PinGlyph category={openVenue.pins[0].category} seeded={openVenue.pins[0].seeded} />
            <View style={styles.venueTitle}>
              <ThemedText type="headline" numberOfLines={1}>
                {clusterTitle(openVenue)}
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {openVenue.pins.length} plans here
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setVenueKey(null)}
              hitSlop={8}>
              <SymbolView
                name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
                size={22}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          </View>
          <ScrollView style={styles.venueList} contentContainerStyle={styles.venueListContent}>
            {openVenue.pins.map((pin) => (
              <PressableScale
                key={pin.id}
                accessibilityRole="button"
                accessibilityLabel={`${pin.venue_name}, ${pin.display_name ?? 'a traveler'}`}
                scaleTo={0.98}
                haptic="soft"
                onPress={() => {
                  setVenueKey(null);
                  setSelectedPinId(pin.id);
                  analytics.capture('pin_tapped', {
                    seeded: pin.seeded,
                    category: pin.category,
                    from: 'venue',
                  });
                }}>
                <ThemedView type="surfaceSunken" style={styles.venueRow}>
                  <View style={styles.venueRowText}>
                    <ThemedText type="callout" numberOfLines={1}>
                      {pin.note?.trim() || pin.venue_name}
                    </ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                      {[pin.display_name, intentLabel(pin.intent_date)].filter(Boolean).join(' · ')}
                    </ThemedText>
                  </View>
                  <SymbolView
                    name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                    size={14}
                    tintColor={theme.textSecondary}
                  />
                </ThemedView>
              </PressableScale>
            ))}
          </ScrollView>
        </Sheet>
      ) : null}

      {/* Non-modal on purpose. A pin card is a card ABOUT the map, so the
          map has to stay alive underneath it: pannable, and tapping another
          marker swaps the card in place instead of making you dismiss this
          one first. That needs both halves — no scrim to catch the touch,
          and no native Modal window to swallow it. */}
      {mode === 'browse' && selectedPin && activeCityId != null ? (
        <Sheet inline dimmed={false} onClose={() => setSelectedPinId(null)}>
          {isGuest && !selectedPin.seeded ? (
            // Same trap as the card below it: this gate pushes to sign-up, and
            // pushing from inside the sheet left the map dead to touch when
            // the guest came back.
            <SignUpGate
              reason="See who's going and say hi"
              cta="Create an account"
              compact
              onNavigate={leavingSheet(() => setSelectedPinId(null))}
            />
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
    paddingLeft: Spacing.three,
    // Clearance for the avatar button the rail scrolls underneath, plus the
    // fade over it, so the last chip can always come fully into view.
    paddingRight: HitTarget + Spacing.four,
  },
  legend: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  railFade: {
    position: 'absolute',
    right: HitTarget,
    top: 0,
    bottom: 0,
    width: 24,
  },
  cityChip: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
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
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
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
  venueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  venueTitle: {
    flex: 1,
    gap: 2,
  },
  venueList: {
    // Capped so a very popular corner scrolls instead of filling the screen.
    maxHeight: 260,
  },
  venueListContent: {
    gap: Space.sm,
    paddingBottom: Space.xs,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
  },
  venueRowText: {
    flex: 1,
    gap: 2,
  },
  takeDown: {
    textAlign: 'center',
    textDecorationLine: 'underline',
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
  mapsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingTop: 2,
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
