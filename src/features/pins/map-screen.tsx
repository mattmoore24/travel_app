import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Circle, Marker, Polygon, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import Animated, { FadeInDown, FadeInUp, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PrimaryButton } from '@/components/form/primary-button';
import { AvatarButton } from '@/components/ui/avatar-button';
import { GlassSurface } from '@/components/ui/glass-surface';
import { PressableScale } from '@/components/ui/pressable-scale';
import { LoadError } from '@/components/ui/load-error';
import { MAP_WASH, QUIET_BASEMAP, SHOW_POINTS_OF_INTEREST, washBox } from '@/features/pins/basemap';
import { Sheet, SHEET_SETTLE_MS, leavingSheet } from '@/components/ui/sheet';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  Type,
  BottomTabInset,
  Elevation,
  HitTarget,
  Motion,
  Radius,
  Space,
  Spacing,
} from '@/constants/theme';
import { useDeletePin, useJoinPinChat, useLaunchCities, usePinCrew } from '@/features/pins/hooks';
import { BusinessMarker, PlaceGlyph } from '@/features/business/business-marker';
import { useCityBusinesses, useOwnBusiness } from '@/features/business/hooks';
import { PlaceSheet } from '@/features/business/place-sheet';
import { useIsGuest, useIsSignedOut, useMapHeat, useMapPins } from '@/features/guest/hooks';
import { KeyboardDoneBar } from '@/components/form/keyboard-done-bar';
import { AudienceChip } from '@/features/pins/audience-chip';
import { audienceInSentence } from '@/features/profile/audience';
import {
  CITY_ZOOM_DELTA,
  clusterPins,
  clusterTitle,
  metersBetween,
  type PinCluster,
} from '@/features/pins/cluster';
import { heatRings, mergeHeatCells } from '@/features/pins/heat';
import { useHeatLegend, usePlacesLegend } from '@/features/pins/heat-legend';
import {
  CityCountView,
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
import {
  DEFAULT_FILTERS,
  daysFor,
  heatDay,
  isDefault,
  pinPasses,
  showsBusinesses,
  type MapFilters,
} from '@/features/pins/filters';
import { crewLabel } from '@/features/pins/crew';
import { FilterButton, MapFilterSheet } from '@/features/pins/map-filter-sheet';
import { useMyChats } from '@/features/matching/hooks';
import { useOwnUserId, useOwnVisibility, usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { countOf } from '@/lib/plural';
import type { CityPinRow, PinCategory, PinCrewRow } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

function PinCard({
  pin,
  cityId,
  onClose,
  onNeedsAccount,
}: {
  pin: CityPinRow;
  cityId: number;
  onClose: () => void;
  /**
   * Somebody with no session at all tapped Join. A guest ACCOUNT can join —
   * it has a name and the group can hold it accountable — but a signed-out
   * visitor has nothing to put in the room, and the RPC would answer with a
   * raw 'not authenticated' alert. The map owns the gate, because a sheet
   * cannot present one over itself.
   */
  onNeedsAccount: () => void;
}) {
  const theme = useTheme();
  const ownUserId = useOwnUserId();
  const { data: photoUrl } = usePhotoUrl(pin.photo_path);
  const deletePin = useDeletePin(cityId);
  const isOwn = pin.user_id != null && pin.user_id === ownUserId;

  // Open to join is a property of the pin, and being in it is a property of
  // you. The second needs no request of its own: the chat list already knows
  // every room this account is in.
  const joinPin = useJoinPinChat(cityId);
  const signedOut = useIsSignedOut();
  const { data: chats = [] } = useMyChats();
  const openToJoin = pin.chat_id != null;
  const alreadyIn = openToJoin && chats.some((chat) => chat.chat_id === pin.chat_id);
  // pin_crew is granted to `authenticated` only — a guest account included,
  // a signed-out visitor not. Asking anyway would be a 403 per open pin.
  const { data: crew = [] } = usePinCrew(pin.id, openToJoin && !signedOut);

  // This card lives inside a Sheet, which is a Modal, so every push from here
  // has to leave the sheet first. See components/ui/sheet for why.
  const leaveThen = leavingSheet(onClose);

  // Media first, the way the research asked for it: the plan set over a
  // picture, the metadata quiet under it, one action. Only when there is
  // actually a face to lead with - your own pin does not need your own
  // photograph, a curated pin has nobody, and a guest's feed is stripped of
  // photo_path server-side, so all three fall through to the old header.
  const hero = !pin.seeded && !isOwn && photoUrl != null;

  return (
    <ThemedView style={styles.pinCard}>
      {hero ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${pin.display_name ?? 'this traveler'}'s profile`}
          scaleTo={0.99}
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
          <View style={styles.hero}>
            <Image source={{ uri: photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(2,3,9,0.85)']}
              locations={[0.35, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={styles.heroText} pointerEvents="none">
              <Text style={styles.heroTitle} numberOfLines={2}>
                {pin.note?.trim() || pin.venue_name}
              </Text>
              <View style={styles.nameRow}>
                <Text style={styles.heroName}>
                  {pin.display_name ?? 'Traveler'}
                  {pin.age != null ? `, ${pin.age}` : ''}
                </Text>
                {pin.verified ? (
                  <VerifiedSeal size={13} name={pin.display_name} age={pin.age} onPhoto />
                ) : null}
              </View>
            </View>
          </View>
        </PressableScale>
      ) : null}
      <View style={styles.pinCardHeader}>
        {/* The same disc and glyph as the marker you just tapped, so the
            card reads as that pin opening rather than a new object. Your own
            pin gets the celebration spring: dropping one is the affirming
            act on this screen and it deserves a beat. */}
        {hero ? null : (
          <Animated.View
            entering={isOwn ? ZoomIn.springify().duration(550).dampingRatio(0.75) : undefined}>
            <PinGlyph category={pin.category} seeded={pin.seeded} />
          </Animated.View>
        )}
        <View style={styles.pinCardTitle}>
          {hero ? null : (
            <ThemedText type="headline" numberOfLines={1}>
              {pin.venue_name}
            </ThemedText>
          )}
          {hero ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
              {pin.venue_name}
            </ThemedText>
          ) : null}
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

      {pin.note && !hero ? <ThemedText type="body">{pin.note}</ThemedText> : null}

      {pin.seeded ? (
        <>
          {pin.seed_note ? <ThemedText type="body">{pin.seed_note}</ThemedText> : null}
          <ThemedText type="footnote" themeColor="textSecondary">
            {SEEDED_LABEL}
          </ThemedText>
        </>
      ) : (
        <>
          {/* Tap the person to read them properly before deciding — unless
              the person is you. On your own pin this row read "Maestro Test,
              27 / Tap to see their profile" directly above "Your pin", so the
              same card called you a stranger and then called the pin yours,
              a centimetre apart. You already know who you are, and your own
              profile is one tap away in the header. */}
          {!isOwn && !hero ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`${pin.display_name ?? 'this traveler'}'s profile`}
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
              <View style={styles.pinnerCard}>
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
                </View>
                <SymbolView
                  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                  size={14}
                  tintColor={theme.textSecondary}
                />
              </View>
            </PressableScale>
          ) : null}

          {/* Who is already going. Faces before the button, because "three
              people are in" is the thing that decides it, and the button is
              only the consequence. */}
          {openToJoin && crew.length > 0 ? <CrewRow crew={crew} count={pin.crew} /> : null}

          {isOwn ? (
            // Your own pin, which is a thing you just DID, not a thing to
            // undo. It used to climax in a red delete button: the one
            // affirming act on the map ended on the most alarming control in
            // the app. Now the pin says what it is and when it burns out,
            // Done is the action, and taking it down is a quiet footnote.
            <>
              {/* Just "Your pin". The header two lines up already says
                  "Today · burns out in 14h", and printing the same countdown
                  twice in one short sheet reads as a duplicated component
                  rather than a reminder. */}
              <ThemedText type="footnote" themeColor="textSecondary">
                {openToJoin ? 'Your plan, open to join' : 'Your pin'}
              </ThemedText>
              {openToJoin ? (
                <PrimaryButton
                  label="Open the chat"
                  onPress={() =>
                    leaveThen(() =>
                      router.push({ pathname: '/room/[id]', params: { id: pin.chat_id! } })
                    )
                  }
                />
              ) : (
                <PrimaryButton label="Done" onPress={onClose} />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take it down early"
                hitSlop={10}
                onPress={() =>
                  Alert.alert('Take it down?', undefined, [
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
          ) : openToJoin ? (
            // The whole point of the feature: no hello to write, nobody to
            // wait on. Somebody already in it gets the door rather than the
            // doorbell.
            <>
              <PrimaryButton
                label={alreadyIn ? 'Open the chat' : 'Join this plan'}
                loading={joinPin.isPending}
                onPress={async () => {
                  if (signedOut) {
                    onNeedsAccount();
                    return;
                  }
                  if (alreadyIn) {
                    leaveThen(() =>
                      router.push({ pathname: '/room/[id]', params: { id: pin.chat_id! } })
                    );
                    return;
                  }
                  try {
                    const chatId = await joinPin.mutateAsync(pin.id);
                    haptics.success();
                    leaveThen(() =>
                      router.push({ pathname: '/room/[id]', params: { id: chatId } })
                    );
                  } catch {
                    // The global mutation alert says why (the plan closed, or
                    // an admin took you out of it).
                  }
                }}
              />
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.joinNote}>
                {alreadyIn
                  ? 'You are in this one.'
                  : `${pin.display_name ?? 'They'} opened this to anyone. You can leave any time.`}
              </ThemedText>
            </>
          ) : (
            <>
              <PrimaryButton
                label="Say hi"
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
                        // Never place_label: that is the reverse-geocoded
                        // ADDRESS, so the draft came out as "your plans at
                        // Somdet Phra Pokklao Bridge, Wang Burapha Phirom".
                        draft: `Hey! What time are you heading to ${pin.venue_name}?`,
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
 * The faces on an open plan.
 *
 * Overlapping discs rather than a list, because this is a glance and not a
 * roster — the group screen is where you read names. The author is first
 * (pin_crew orders them that way), so the leftmost face is always whose plan
 * it is.
 */
function CrewRow({ crew, count }: { crew: PinCrewRow[]; count: number }) {
  const shown = crew.slice(0, 5);
  return (
    <View
      style={styles.crewRow}
      accessibilityRole="text"
      accessibilityLabel={`${countOf(count, 'person', 'people')} going`}>
      <View style={styles.crewFaces}>
        {shown.map((person, index) => (
          <CrewFace key={person.user_id} person={person} first={index === 0} />
        ))}
      </View>
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.crewText}>
        {crewLabel(shown, count)}
      </ThemedText>
    </View>
  );
}

function CrewFace({ person, first }: { person: PinCrewRow; first: boolean }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(person.photo_path);
  return (
    <View
      style={[
        styles.crewFace,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.surface,
          marginLeft: first ? 0 : -10,
        },
      ]}>
      {url ? (
        <Image source={{ uri: url }} style={styles.fill} contentFit="cover" />
      ) : (
        <ThemedText type="caption" themeColor="textSecondary">
          {(person.display_name ?? '?').slice(0, 1).toUpperCase()}
        </ThemedText>
      )}
    </View>
  );
}

const SEEDED_LABEL = 'One of our picks. Show up.';

/**
 * How far the map centre can drift from a searched place before the pin
 * stops being about that place. Roughly a venue's own footprint.
 */
const PLACE_DRIFT_M = 40;

/**
 * One marker for the whole city, once the map is zoomed past street scale:
 * at that size every venue is smaller than a fingertip, and a hundred
 * overlapping pins say less than one number does.
 *
 * Its own component so it can hold the tracking timer every other marker on
 * this map already holds. react-native-maps defaults tracksViewChanges to
 * true, which re-rasterises the React child into a native image on EVERY
 * frame of a pan or a pinch — for the one marker that is on screen during
 * exactly the gesture people use most.
 */
function CityScaleMarker({
  lat,
  lng,
  name,
  count,
  category,
  onPress,
}: {
  lat: number;
  lng: number;
  name: string;
  count: number;
  category: PinCategory;
  onPress: () => void;
}) {
  const tracking = useMarkerTracking(`${count}:${name}`);
  return (
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      anchor={MARKER_ANCHOR}
      centerOffset={MARKER_CENTER_OFFSET}
      tracksViewChanges={tracking}
      accessibilityRole="button"
      accessibilityLabel={`${countOf(count, 'plan')} in ${name}`}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}>
      <CityCountView name={name} count={count} />
    </Marker>
  );
}

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
  const tracking = useMarkerTracking(`${selected}:${photoUri ?? ''}:${pin.chat_id ?? ''}`);
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
        pin.chat_id ? 'open to join' : null,
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
        open={pin.chat_id != null}
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
  // Only so the points of interest can be turned off in a later commit than
  // the map type. See features/pins/basemap.
  const launchCitiesQuery = useLaunchCities();
  const launchCities = launchCitiesQuery.data ?? [];
  const [cityId, setCityId] = useState<number | null>(null);
  const activeCityId = cityId ?? launchCities[0]?.city_id ?? null;
  const activeCity = launchCities.find((c) => c.city_id === activeCityId);
  // Everything the map is narrowed by, behind one control. It used to be
  // three date chips and nothing else, which filtered the dimension people
  // asked about least and offered no way to ask about who is on the map at
  // all. See features/pins/filters.
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // One date for the heat RPC, which takes a single day, and the set of dates
  // the pin markers accept. They differ because two clocks write intent_date -
  // see filterDates.
  const filterISO = heatDay(filters.day);
  const filterSet = useMemo(() => daysFor(filters.day), [filters.day]);
  const pinsQuery = useMapPins(activeCityId);
  const { data: allPins = [], isSuccess: pinsLoaded } = pinsQuery;
  const { data: heat = [] } = useMapHeat(activeCityId, filterISO);
  const heatCells = useMemo(() => mergeHeatCells(heat), [heat]);
  const legend = useHeatLegend(heatCells.length > 0);
  const isGuest = useIsGuest();
  // A guest has no setting of their own, and the hook is disabled without a
  // user id, so this falls back to 'everyone' for them.
  const { data: audience = 'everyone' } = useOwnVisibility();
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  // Places are the third marker family, and they are quiet on purpose:
  // people stack on top of places, which is the right sentence for this app.
  const { data: places = [] } = useCityBusinesses(activeCityId);
  // One at a time. Two chips stacked over a map is furniture, so the places
  // one waits until the heat one has been read and dismissed.
  // A place is not a traveler and may not drop a 72-hour pin (§7 rule 8, six
  // BEFORE INSERT triggers). Without this the owner filled in the whole pin
  // form and was refused by a raw database alert at the end of it.
  const isBusiness = useOwnBusiness().data != null;
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  // Every other gate in the app states its reason before it asks. Dropping a
  // pin was the one that did not: it teleported a guest to an email form with
  // no explanation of what had just happened to them.
  // Which gate is open, if any. Two of them now: dropping a pin, and joining
  // somebody else's plan. One piece of state rather than two booleans,
  // because only one sheet may ever be up.
  const [gate, setGate] = useState<'drop' | 'join' | null>(null);
  // Which stack of plans is open, if any. Separate from selectedPinId: a
  // stack is a list of plans, and picking one out of it opens the pin card.
  const [venueKey, setVenueKey] = useState<string | null>(null);
  // Past city scale, individual venues are smaller than a fingertip, so the
  // whole city becomes one marker with a count. Held as state rather than in
  // the region ref because it has to repaint — but it only ever changes when
  // the threshold is crossed, not on every frame of a pinch.
  const [cityScale, setCityScale] = useState(false);
  // `!cityScale` matters as much as the count: place markers are only drawn
  // past city scale, so without it the chip invited somebody to "tap a business"
  // on a map showing none — the app contradicting itself, which is the whole
  // reason the legend exists.
  const placesLegend = usePlacesLegend(!cityScale && places.length > 0 && !legend.visible);

  // The drop-a-pin flow lives on this map, not a separate screen: browse →
  // place (map pans under a fixed pin) → detail (form sheet over the map).
  const [mode, setMode] = useState<MapMode>('browse');
  const [lifted, setLifted] = useState(false);
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [searchedPlace, setSearchedPlace] = useState<LocalSearchResult | null>(null);
  const lastRegion = useRef<Region | null>(null);

  const pins = useMemo(
    () => allPins.filter((pin) => pinPasses(pin, filters, filterSet)),
    [allPins, filters, filterSet]
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
    // The pin card and the venue stack heal themselves — both are looked up
    // in the city's own list, so they resolve to null the moment the list
    // reloads. The place card does not: it is handed a bare id and
    // `business-detail` is cached under that id alone, so without this the
    // card for a bar in Bangkok stays parked at the bottom of the Lisbon map,
    // with Join the chat and Message still wired to it.
    setSelectedPlaceId(null);
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
    if (isBusiness) {
      return;
    }
    if (isGuest) {
      setGate('drop');
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
          // See features/pins/basemap for what each of these does. Yes, the
          // POI prop is the plural spelling.
          {...QUIET_BASEMAP}
          showsPointsOfInterests={SHOW_POINTS_OF_INTEREST}
          scrollEnabled={mode !== 'detail'}
          onPress={() => {
            if (mode === 'browse') {
              setSelectedPinId(null);
              setVenueKey(null);
              // Same omission as the city switch had: a tap on empty basemap
              // is how anybody dismisses a card, and the place card was the
              // one that ignored it.
              setSelectedPlaceId(null);
            }
          }}
          onRegionChange={() => {
            if (mode === 'place') {
              setLifted(true);
              // Dragging the map is the instruction the search field gives
              // when nothing matched ("try the street, or drag the map to
              // the spot"), and the keyboard used to stay up through the
              // whole drag, covering the bottom third of the map and the
              // "Pin here" button underneath it.
              Keyboard.dismiss();
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
          {/* A light ink wash over the cartography, under everything of
              ours. There is no prop for Apple's park green, water blue or
              label treatment: MKPointOfInterestFilter covers business
              categories only. An overlay is the one remaining lever, and
              MapKit draws every overlay BENEATH every annotation, so it
              pulls the ground toward the app's navy without touching a
              single pin. Added first so the heat rings composite over it.

              Deliberately light. It used to be nearly two and a half times
              this over mutedStandard, which was two darkeners doing one job
              and left street names at about 2:1 - see basemap.ts. Tune the
              constant there before reaching for the map type.

              The box is generous rather than global on purpose: a polygon
              spanning the whole earth has to be reasoned about at the
              antimeridian, and none of the launch cities is anywhere near
              it. Twenty degrees is roughly 2,200km, far past any zoom this
              screen allows. */}
          {activeCity ? (
            <Polygon
              coordinates={washBox(activeCity.cities.lat, activeCity.cities.lng)}
              fillColor={MAP_WASH}
              strokeColor="transparent"
              strokeWidth={0}
              tappable={false}
            />
          ) : null}

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
          {cityScale && activeCity && pins.length > 0 ? (
            <CityScaleMarker
              lat={activeCity.cities.lat}
              lng={activeCity.cities.lng}
              name={activeCity.cities.name}
              count={pins.length}
              category={pins[0].category}
              onPress={() => {
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
              }}
            />
          ) : null}

          {/* Declared FIRST so places sit beneath every traveler pin. Two
              things are doing that work: MapKit honours declaration order for
              equal zIndex, and BusinessMarker sets a lower one explicitly.
              Only past city scale, so the city view stays about travelers -
              which is also what Apple's own POI labels do. */}
          {!cityScale && !placing && showsBusinesses(filters)
            ? places.map((place) => (
                <BusinessMarker
                  key={place.id}
                  business={place}
                  onPress={() => {
                    if (place.id === selectedPlaceId) {
                      return;
                    }
                    haptics.light();
                    // One card at a time. A place sheet and a pin card open on
                    // the same corner of the screen.
                    setSelectedPinId(null);
                    setVenueKey(null);
                    setSelectedPlaceId(place.id);
                  }}
                />
              ))
            : null}

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
                    setSelectedPlaceId(null);
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
                    setSelectedPlaceId(null);
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
              title="No cities yet"
              description="We're opening more soon. Check back."
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
          </View>
          <View style={styles.dateRow}>
            {/* The row scrolls now, and the avatar is a real sibling at the
                end of it rather than a floating overlay.

                It used to be absolutely positioned, on the reasoning that
                this row is "three short chips and then nothing" - true while
                the row only ever held three short chips. The audience chip
                below is a fourth and it can read "Verified non-binary": three
                date chips leave about 90pt clear of the avatar on a 375pt
                screen and that label needs about 165, so a fourth chip would
                have run underneath it.

                A scrolling box that ENDS where the avatar begins fixes it for
                any label at any width, and it does not repeat the mistake the
                city rail already paid for: content clips at the avatar's edge
                instead of sliding under it, so nothing is ever half-covered
                at rest. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.dateChips}
              style={styles.dateScroll}>
              {/* One control where three date chips used to be. The chips
                  filtered the dimension people asked about least — and
                  offered no way at all to ask the question they actually
                  have, which is who and what is on the map. Everything is
                  behind this now, and it carries a count so a narrowed map
                  is never a mystery. */}
              <FilterButton
                filters={filters}
                onPress={() => {
                  // The header stays live under an inline sheet, so this is
                  // reachable with a pin card or a venue stack already open —
                  // and three sheets at the bottom of one map is a pile.
                  setSelectedPinId(null);
                  setSelectedPlaceId(null);
                  setVenueKey(null);
                  setFiltersOpen(true);
                }}
              />

              {/* Renders nothing while the audience is open, so the common
                  case is one chip and the avatar. */}
              <AudienceChip audience={audience} />
            </ScrollView>
            <View style={styles.avatarDock}>
              <AvatarButton />
            </View>
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
              accessibilityLabel="Cancel"
              hitSlop={8}
              scaleTo={0.9}
              haptic="soft"
              onPress={exitPlaceMode}>
              {/* Opaque, not glass. Run 44 caught this X over a traveler's
                  avatar pin with the lower half of both strokes swallowed by
                  a bright photograph; run 45 proved that regular glass is
                  barely more than clear glass over a map, and only read
                  because the pin had moved off it. This is the only control
                  that leaves place mode, and the brief is explicit that glass
                  is a finish and never the thing carrying contrast. A surface
                  and a ring carry it on every OS, glass or no glass. */}
              <View
                pointerEvents="none"
                style={[
                  styles.cancelButton,
                  { backgroundColor: theme.surface, borderColor: theme.hairline },
                ]}>
                <SymbolView
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  size={16}
                  tintColor={theme.text}
                />
              </View>
            </PressableScale>
          </View>
        </Animated.View>
      ) : null}

      {/* A failed pin query used to render exactly what an empty city renders:
          a bare map, and not even the "no pins yet" card, because that card is
          gated on isSuccess. So "I'm not seeing any pins" could mean the city
          is quiet OR that the request died, and nothing on the screen told
          anyone which. Every other query on this map already distinguishes the
          two - launchCitiesQuery does it fifteen lines up. */}
      {activeCity && mode === 'browse' && pinsQuery.isError && !selectedPin ? (
        <View
          style={[
            styles.emptyBanner,
            { bottom: BottomTabInset + insets.bottom + Spacing.five + 64 },
          ]}>
          <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
            <LoadError
              what="the pins"
              error={pinsQuery.error}
              onRetry={() => pinsQuery.refetch()}
            />
          </GlassSurface>
        </View>
      ) : null}

      {activeCity &&
      mode === 'browse' &&
      !isBusiness &&
      pinsLoaded &&
      pins.length === 0 &&
      !selectedPin ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Be the first to drop a pin"
          onPress={enterPlaceMode}
          style={[
            styles.emptyBanner,
            { bottom: BottomTabInset + insets.bottom + Spacing.five + 64 },
          ]}>
          <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
            {/* The audience wins over the filters, because it is the one
                with nothing on screen to show it is on. The Filters button
                carries a count; a narrowed audience removed pins and said
                nothing at all, which reads as an empty city. */}
            <ThemedText type="smallBold">
              {audience !== 'everyone'
                ? `Nothing pinned for ${audienceInSentence(audience)} yet`
                : isDefault(filters)
                  ? `No pins in ${activeCity.cities.name} yet`
                  : 'Nothing matches your filters'}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {audience === 'everyone' && !isDefault(filters)
                ? 'Widen them, or be the first.'
                : 'Be the first.'}
            </ThemedText>
          </GlassSurface>
        </Pressable>
      ) : null}

      {activeCity && mode === 'browse' && !isBusiness && !selectedPin ? (
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
            // The form lets you pin for tomorrow — at a beach, unverified —
            // while the map is filtered to today's bars, and both the markers
            // and the confirmation card read from the FILTERED list, so the
            // sheet closed on a map that looked untouched and said nothing
            // had been pinned. Clearing every filter is the only setting
            // guaranteed to contain whatever was just posted.
            setFilters(DEFAULT_FILTERS);
            // Sheets are presented as modals, and iOS silently drops a
            // presentation that begins while another modal is still
            // dismissing — which left a freshly dropped pin with no
            // confirmation card at all. Wait for the form to finish leaving,
            // then select it (the card also needs the refetched row).
            setTimeout(() => setSelectedPinId(pinId), SHEET_SETTLE_MS);
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
            accessibilityLabel="Glowing spots are plans nearby"
            accessibilityHint="Dismisses this"
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

      {placesLegend.visible && !legend.visible && mode === 'browse' ? (
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
            accessibilityLabel="The small chips are businesses. Tap one to see what's on."
            accessibilityHint="Dismisses this"
            scaleTo={0.96}
            haptic="light"
            onPress={placesLegend.dismiss}>
            <View
              style={[
                styles.legendChip,
                { backgroundColor: theme.surface, borderColor: theme.hairline },
              ]}>
              <PlaceGlyph category="bar" live={false} size={18} onSurface />
              <ThemedText type="footnote">Tap a business to see what&apos;s on</ThemedText>
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={11}
                tintColor={theme.textSecondary}
              />
            </View>
          </PressableScale>
        </Animated.View>
      ) : null}

      {gate ? (
        <Sheet onClose={() => setGate(null)}>
          <SignUpGate
            reason={
              gate === 'join'
                ? 'Joining puts you in the chat, with a name'
                : 'Pins come with your name on them'
            }
            where={gate === 'join' ? 'join-plan' : 'drop-pin'}
            cta="Make a profile"
            compact
            // Pushing a route from inside a sheet leaves its scrim over the
            // map and every later tap lands on nothing. See components/ui/sheet.
            onNavigate={leavingSheet(() => setGate(null))}
          />
        </Sheet>
      ) : null}

      {/* Inline, so the map answers every tick behind it — which is the
          whole argument against an Apply button, and why there isn't one.
          Never a pushed route: a route opened from inside a presented sheet
          goes UNDER its scrim, and the scrim outlives it.

          Gated on browse for the same reason every other sheet here is:
          while somebody is placing a pin, the map is a viewfinder and nothing
          else may sit on top of it. */}
      {mode === 'browse' && filtersOpen ? (
        <MapFilterSheet
          filters={filters}
          onChange={setFilters}
          onClose={() => setFiltersOpen(false)}
        />
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
              where="pin-card"
              cta="Create an account"
              compact
              onNavigate={leavingSheet(() => setSelectedPinId(null))}
            />
          ) : (
            <PinCard
              pin={selectedPin}
              cityId={activeCityId}
              onClose={() => setSelectedPinId(null)}
              onNeedsAccount={() =>
                leavingSheet(() => setSelectedPinId(null))(() => setGate('join'))
              }
            />
          )}
        </Sheet>
      ) : null}

      {/* Same non-modal treatment as the pin card, and for the same reason:
          a place card is a card ABOUT the map, so tapping another marker
          swaps it in place rather than making you dismiss this one first. */}
      {mode === 'browse' && selectedPlaceId ? (
        <PlaceSheet businessId={selectedPlaceId} onClose={() => setSelectedPlaceId(null)} />
      ) : null}

      {/* The map is not a StepScreen, so it mounts its own. The pin search
          field is the one place on this screen somebody types, and "Pin
          here" sits under the keyboard while they do. */}
      <KeyboardDoneBar />
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
    alignItems: 'center',
    // The horizontal padding moved into the scroll view's content, so the
    // first chip still starts where it always did while the scrollable area
    // itself runs to the avatar.
    marginTop: Spacing.two,
  },
  searchWrap: {
    flex: 1,
    paddingLeft: Spacing.three,
  },
  cancelButton: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: HitTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    ...Elevation.floating,
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
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  crewFaces: {
    flexDirection: 'row',
  },
  crewFace: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  crewText: {
    flex: 1,
  },
  joinNote: {
    textAlign: 'center',
  },
  takeDown: {
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  /* A row, not a card. It used to be a sunken surface inside the sheet's own
     surface - card-on-card, which DESIGN.md bans over the map - and it said
     "Tap to see their profile" under a name that is obviously tappable. */
  pinnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.xs,
  },
  hero: {
    aspectRatio: 3 / 2,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  heroText: {
    padding: Space.lg,
    gap: 2,
  },
  heroTitle: {
    ...Type.headline,
    color: '#FFFFFF',
  },
  heroName: {
    ...Type.footnote,
    color: 'rgba(255,255,255,0.88)',
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
  },
  avatarDock: {
    // A flex sibling at the end of the row, not an overlay. The button is
    // taller than a date chip, so it stands proud of the row by the same 6pt
    // it used to, which is what keeps it reading as one piece of chrome with
    // the rail above rather than as a third row.
    marginVertical: -6,
    marginRight: Spacing.three,
    justifyContent: 'center',
  },
  dateScroll: {
    flex: 1,
  },
  dateChips: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
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
    fontSize: Type.callout.fontSize,
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
