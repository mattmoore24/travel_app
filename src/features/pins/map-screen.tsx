import { Image } from 'expo-image';
// Only ever geocoding: typed text to coordinates and back. Nothing here may
// read the device's position.
import * as Location from 'expo-location';
import { router, useIsFocused } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Circle, Marker, Polygon, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import Animated, { FadeInDown, FadeInUp, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { useAuthStore } from '@/features/auth/store';
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
import { Type, Elevation, HitTarget, Motion, Radius, Space, Spacing } from '@/constants/theme';
import {
  useDeletePin,
  useFeaturedCities,
  useHeatHistory,
  useJoinPinChat,
  useLaunchCities,
  usePinCrew,
} from '@/features/pins/hooks';
import { browseCityFromCityRow, browseCityFromLaunch, type BrowseCity } from '@/features/pins/api';
import { BusinessMarker, PlaceGlyph } from '@/features/business/business-marker';
import { useCityBusinesses, useIsBusiness, useOwnBusiness } from '@/features/business/hooks';
import { listingNotice } from '@/features/business/listing-notice';
import { PlaceSheet } from '@/features/business/place-sheet';
import {
  useIsGuest,
  useIsSignedOut,
  useMapHeat,
  useMapPins,
  useWantsBusiness,
} from '@/features/guest/hooks';
import { AudienceChip } from '@/features/pins/audience-chip';
import { audienceInSentence } from '@/features/profile/audience';
import { deviceTimezone, pickBrowsingCity } from '@/features/pins/browsing-city';
import { useCityChoice } from '@/features/pins/city-store';
import { FAR_FROM_CITY_M, anyInRegion, fitRegion, homeRegion } from '@/features/pins/camera';
import {
  CITY_ZOOM_DELTA,
  clusterByScreen,
  clusterCategory,
  clusterIntentDate,
  clusterPins,
  clusterTitle,
  metersBetween,
  screenClusterPins,
  type PinCluster,
  type ScreenCluster,
} from '@/features/pins/cluster';
import { dockFootingOf, messageSlotOf } from '@/features/pins/bottom-stack';
import {
  HEAT_CELL_RADIUS_M,
  heatFill,
  heatRings,
  heatViewReady,
  heatWithFallback,
  mergeHeatCells,
} from '@/features/pins/heat';
import { useHeatLegend, usePlacesLegend } from '@/features/pins/heat-legend';
import {
  CityCountView,
  MARKER_ANCHOR,
  MARKER_CENTER_OFFSET,
  PinGlyph,
  PinMarkerView,
  PinStackView,
  STACK_CENTER_OFFSET,
  useMarkerTracking,
} from '@/features/pins/pin-marker';
import { openInMaps } from '@/features/pins/open-in-maps';
import { createDropGate, shouldDismissOnPan, splitSpotLabel } from '@/features/pins/place-mode';
import {
  PLAN_LIST_PEEK,
  PlanList,
  listableBusinesses,
  type PlanListDetent,
} from '@/features/pins/plan-list';
import { PinFormSheet } from '@/features/pins/pin-form-sheet';
import { FormTextField } from '@/components/form/form-text-field';
import { PinSearchField } from '@/features/pins/pin-search-field';
import { nearbyPlaces, type LocalSearchResult } from '@/modules/local-search';
import { PlacePinOverlay } from '@/features/pins/place-pin-overlay';
import {
  GEOCODE_FLOOR_MS,
  type MapPin,
  burnOutLabel,
  byIntentMoment,
  cityClockNow,
  isLaterCityDay,
  pinSubtitle,
  pinTitle,
  shouldGeocode,
  whenLabel,
} from '@/features/pins/pin-helpers';
import {
  DEFAULT_FILTERS,
  daysFor,
  heatDay,
  isDefault,
  mapResultCount,
  pinPasses,
  showsBusinesses,
  showsHeat,
  type MapFilters,
} from '@/features/pins/filters';
import { crewLabel } from '@/features/pins/crew';
import { useCitySearch, useMyTrips } from '@/features/trips/hooks';
import { toISODate } from '@/features/trips/dates';
import { FilterButton, MapFilterSheet } from '@/features/pins/map-filter-sheet';
import { helloExpired, helloWithdrawn, saidHiAlready } from '@/features/matching/already-sent';
import { useMyChats, useSentRequests, useFirstMessageBudget } from '@/features/matching/hooks';
import { chooseSlot } from '@/features/pins/message-slot';
import { usePushPrimer } from '@/features/notifications/primer-store';
import {
  useOwnProfile,
  useOwnUserId,
  useOwnVisibility,
  usePhotoUrl,
} from '@/features/profile/hooks';
import { useAnnounce } from '@/features/chat/use-announce';
import { useAccessibilitySettings } from '@/hooks/use-accessibility-settings';
import { useTabDockBottom } from '@/hooks/use-tab-bar-inset';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { countOf } from '@/lib/plural';
import type { CityPinRow, PinCategory, PinCrewRow } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

function PinCard({
  pin,
  cityId,
  clock,
  onClose,
  onOpenBusiness,
  onNeedsAccount,
}: {
  pin: MapPin;
  cityId: number;
  /** The browsed city's wall clock (cityClockNow): "Today" is ITS today. */
  clock: Date;
  onClose: () => void;
  /**
   * This plan is at a listed business and the reader wants to see it. The map
   * owns the swap because both cards are the map's, not each other's.
   */
  onOpenBusiness: (businessId: string) => void;
  /**
   * Somebody with no session at all tapped Join. A guest ACCOUNT can join —
   * it has a name and the group can hold it accountable — but a signed-out
   * visitor has nothing to put in the room, and the RPC would answer with a
   * raw 'not authenticated' alert. The map owns the gate, because a sheet
   * cannot present one over itself.
   */
  onNeedsAccount: () => void;
}) {
  // The same cap the Travelers bar and the stranger profile render:
  // identical chrome must not offer a live "Say hi" the composer would
  // immediately full-stop.
  const budget = useFirstMessageBudget();
  const helloCapped = budget.data != null && budget.data.used >= budget.data.allowed;
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
  // A business never joins a plan. The map is not that for them.
  const viewerIsBusiness = useIsBusiness();
  const { data: chats = [] } = useMyChats();
  // Whether a hello to this pinner is already on its way, or has been and
  // run out. One predicate for every surface that asks
  // (features/matching/already-sent), so the button never routes into the
  // unique-constraint refusal that destroys the message.
  const { data: sentRequests = [] } = useSentRequests();
  const alreadySaidHi = saidHiAlready(sentRequests, pin.user_id);
  // And whether that hello can still be answered. respond_to_message_request
  // only takes a 'pending' row, so once the nightly sweep has ended it there
  // is nobody left who could reply and the note below has to stop promising
  // one. Reads the sweep's stamp, never a state (see already-sent).
  const helloRanOut = helloExpired(sentRequests, pin.user_id);
  // The third thing that can have happened, and the only one they did on
  // purpose. The note below promised a reply to it until now.
  const helloTakenBack = helloWithdrawn(sentRequests, pin.user_id);
  const openToJoin = pin.chat_id != null;
  const alreadyIn = openToJoin && chats.some((chat) => chat.chat_id === pin.chat_id);
  // pin_crew is granted to `authenticated` only — a guest account included,
  // a signed-out visitor not. Asking anyway would be a 403 per open pin.
  //
  // And never for a business. The faces on a plan are up to twenty travelers'
  // photographs and first names, handed to a bar because it tapped a marker:
  // a directory nobody offered and nobody consented to. Not asked for rather
  // than fetched and hidden, so the names never reach the device.
  const { data: crew = [] } = usePinCrew(pin.id, openToJoin && !signedOut && !viewerIsBusiness);

  // This card lives inside a Sheet, which is a Modal, so every push from here
  // has to leave the sheet first. See components/ui/sheet for why.
  const leaveThen = leavingSheet(onClose);

  // Media first, the way the research asked for it: the plan set over a
  // picture, the metadata quiet under it, one action. Only when there is
  // actually a face to lead with - your own pin does not need your own
  // photograph, a curated pin has nobody, and a guest's feed is stripped of
  // photo_path server-side, so all three fall through to the old header.
  //
  // A business is the fourth. Its feed is stripped the same way a guest's is
  // (features/guest/hooks), so there is no face to lead with anyway - but the
  // hero is also a BUTTON into /profile/[userId], a route the router does not
  // mount for a business account, so the whole photograph was a tap that did
  // nothing. Stated here rather than left to the empty feed: the affordance
  // is what is wrong, not the pixels.
  const hero = !pin.seeded && !isOwn && photoUrl != null && !viewerIsBusiness;

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
                {pinSubtitle(pin) ?? pinTitle(pin)}
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
          {/* Two lines, not one: a one-line cap truncated the very venue the
              person is deciding whether to walk to — the same Bangkok address
              the pin form already paid for and fixed. */}
          {hero ? null : (
            <ThemedText type="headline" numberOfLines={2}>
              {pinTitle(pin)}
            </ThemedText>
          )}
          {hero ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
              {pinTitle(pin)}
            </ThemedText>
          ) : null}
          <ThemedText type="footnote" themeColor="textSecondary">
            {whenLabel(pin, clock)} · {burnOutLabel(pin.expires_at)}
          </ThemedText>
          {pin.place_label ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
              {pin.place_label}
            </ThemedText>
          ) : null}
          {/* The two map layers finally meet. A plan at a listed business
              carries its id (20260902190000 links them by name and sixty
              metres at insert time), so the card can hand the reader the
              business page instead of making them leave, find the spot again
              and read about it there. Both cards are inline sheets, so this
              is a swap rather than a presentation, and there is no modal to
              lose (see the traps skill). */}
          {pin.business_id ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`See the business page for ${pin.venue_name}`}
              hitSlop={8}
              onPress={() => onOpenBusiness(pin.business_id!)}
              style={styles.mapsLink}>
              <SymbolView
                name={{ ios: 'storefront', android: 'store', web: 'store' }}
                size={13}
                tintColor={theme.accent}
              />
              <ThemedText type="footnote" themeColor="accent">
                See the business
              </ThemedText>
            </Pressable>
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

      {!hero && pinSubtitle(pin) ? <ThemedText type="body">{pinSubtitle(pin)}</ThemedText> : null}

      {pin.seeded ? (
        <>
          {pin.seed_note ? <ThemedText type="body">{pin.seed_note}</ThemedText> : null}
          <ThemedText type="footnote" themeColor="textSecondary">
            {viewerIsBusiness ? BUSINESS_SEEDED_LABEL : SEEDED_LABEL}
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
          {/* And never for a business. Same dead door as the hero: the row
              pushes /profile/[userId], which is inside the traveler guard and
              is therefore not in a business account's navigator at all, so
              the chevron promised a page and the tap did nothing. A business
              is not shown a traveler as a person to open. */}
          {!isOwn && !hero && !viewerIsBusiness ? (
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
              only the consequence.

              A business has no button for it to be the reason for, and the
              rest of the app already answers what a business sees of a
              traveler: not a row of faces and first names. `crew` is empty
              for them anyway - the query above is not run - and this says
              why. */}
          {openToJoin && !viewerIsBusiness && crew.length > 0 ? (
            <CrewRow crew={crew} count={pin.crew} ownUserId={ownUserId} />
          ) : null}

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
                        // The haptic vocabulary's word for a destructive
                        // confirmation. Feedback only: the §7-rule-3 expiry
                        // path itself is untouched.
                        haptics.warning();
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
          ) : openToJoin && !viewerIsBusiness ? (
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
          ) : viewerIsBusiness ? (
            // Nothing to offer. A business reads the map to see the city it
            // is in, not to meet the people on it, so the sheet stops at what
            // the plan is and who opened it.
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.joinNote}>
              {/* Named after things that exist. There is no "your page" in a
                  business account, and "say hi" is the traveler-to-traveler
                  verb: what a traveler does to a business is message it, and
                  it lands in the Chat tab. */}
              This is how travelers meet each other. When one wants to reach you, they message your
              business and it arrives in your Chat tab.
            </ThemedText>
          ) : alreadySaidHi ? (
            // The same not-now rendering the Travelers bar uses: a colour
            // change (surfaceSunken fill, textSecondary label), never a
            // fade, and never a live button that routes into the
            // unique-constraint rejection.
            <>
              <PrimaryButton label="Message sent" disabled onPress={() => {}} />
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.joinNote}>
                {helloTakenBack
                  ? // Their own doing, said plainly and with no retry:
                    // withdrawing stamps the row rather than deleting it, and
                    // one shot per direction is for ever, so the pair is
                    // spent either way.
                    'You took that one back.'
                  : helloRanOut
                    ? // True for both halves of what the sweep ends, and it
                      // tells the sender nothing about the person: expiry runs
                      // on their own dates. It says only that this one is
                      // over, and offers no retry, because one shot per
                      // direction is for ever.
                      'You said hi a while back. That one has run out.'
                    : "You said hi. It'll be in Chat if they answer."}
              </ThemedText>
            </>
          ) : (
            <>
              <PrimaryButton
                label={helloCapped ? 'No first messages left today' : 'Say hi'}
                disabled={helloCapped}
                onPress={() =>
                  leaveThen(() =>
                    router.push({
                      pathname: '/compose-request',
                      params: {
                        userId: pin.user_id!,
                        name: pin.display_name ?? 'Traveler',
                        photoPath: pin.photo_path ?? '',
                        source: 'pin',
                        // Where the beat afterwards belongs. Not Travelers:
                        // useSendRequest is the app's only send path and its
                        // said-hi store is cleared by that tab alone, so an
                        // unstamped hello from here painted a strip there an
                        // hour later claiming it had just happened.
                        origin: 'pin',
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
function CrewRow({
  crew,
  count,
  ownUserId,
}: {
  crew: PinCrewRow[];
  count: number;
  ownUserId: string | null;
}) {
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
        {crewLabel(shown, count, ownUserId)}
      </ThemedText>
    </View>
  );
}

function CrewFace({ person, first }: { person: PinCrewRow; first: boolean }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(person.photo_path);
  // A definite square, scaled by the font setting: Yoga only derives a
  // length from aspectRatio when the other axis is definite, so the earlier
  // minHeight+aspectRatio pair measured the disc at zero and the crew row
  // collapsed to borders. Capped so five faces still fit beside the label.
  const size = Math.round(28 * Math.min(PixelRatio.getFontScale(), 1.5));
  return (
    <View
      style={[
        styles.crewFace,
        {
          width: size,
          height: size,
          backgroundColor: theme.backgroundElement,
          borderColor: theme.surface,
          marginLeft: first ? 0 : -10,
        },
      ]}>
      {url ? (
        <Image source={{ uri: url }} style={styles.fill} contentFit="cover" />
      ) : (
        <ThemedText type="caption" themeColor="textSecondary">
          {/* Array.from splits on code points, not UTF-16 units: charAt/slice
              on an emoji-leading name rendered a lone surrogate in the disc. */}
          {(Array.from((person.display_name ?? '?').trim())[0] ?? '?').toUpperCase()}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * How dim the remembered layer is.
 *
 * Well under heatPeakAlpha's 0.1-to-0.3 (features/pins/heat.ts), because the
 * two layers say different things and the eye has to be able to tell which
 * one it is looking at: today is a light on, and this is the shape it usually
 * makes. Capped so a street stays readable through both at once.
 */
function historyAlpha(count: number): number {
  return Math.min(0.03 + count * 0.015, 0.09);
}

const SEEDED_LABEL = 'One of our picks. Show up.';
/** The same fact, without the invitation: nobody is asking a bar to show up. */
const BUSINESS_SEEDED_LABEL = 'One of our picks in this city.';

/**
 * How far the map centre can drift from a searched place before the pin
 * stops being about that place. Roughly a venue's own footprint.
 */
const PLACE_DRIFT_M = 40;

/**
 * How far around the placement pin to ask MapKit for venues. About a block:
 * wide enough to catch the bar whose sign is under the pin, narrow enough
 * that the chips are answers to "what is here", not a directory.
 */
const NEARBY_RADIUS_M = 120;

/** At most this many venue chips above the name pill. */
const NEARBY_SHOWN = 3;

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
      // The pill is stack-height, not body-height; at city zoom the couple
      // of points this could still be off are invisible.
      centerOffset={STACK_CENTER_OFFSET}
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
  clock,
  onPress,
}: {
  pin: MapPin;
  selected: boolean;
  /** The browsed city's clock — the one authority for Today and the dim. */
  clock: Date;
  onPress: () => void;
}) {
  // Signed-in viewers see the poster's face on the map; a guest's feed has no
  // photo_path at all (server-stripped), so this simply resolves to nothing.
  const { data: photoUri } = usePhotoUrl(pin.photo_path);
  const ownUserId = useOwnUserId();
  const own = pin.user_id != null && pin.user_id === ownUserId;
  // `own` and the later-day DIM are IN the key: anything that changes what
  // the marker draws must re-open the rasterization window, or the ring and
  // the dim are simply missing from the frozen bitmap. The derived boolean
  // rather than the stored date, because across local midnight the date is
  // unchanged while the dim flips. The CITY variant, because `clock` is the
  // synthetic city Date — isLaterDay's ISO leg misreads it (pin-helpers).
  const later = isLaterCityDay(pin.intent_date, clock);
  const tracking = useMarkerTracking(
    `${selected}:${photoUri ?? ''}:${pin.chat_id ?? ''}:${own}:${later}`
  );
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
        whenLabel(pin, clock),
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
        own={own}
        later={later}
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
  clock,
  onPress,
}: {
  cluster: PinCluster;
  selected: boolean;
  /** The browsed city's clock — the one authority for the later-day dim. */
  clock: Date;
  onPress: () => void;
}) {
  const first = usePhotoUrl(cluster.pins[0]?.photo_path ?? null);
  const second = usePhotoUrl(cluster.pins[1]?.photo_path ?? null);
  const third = usePhotoUrl(cluster.pins[2]?.photo_path ?? null);
  const faces = [first.data ?? null, second.data ?? null, third.data ?? null].slice(
    0,
    Math.min(3, cluster.pins.length)
  );
  // The dominant category, not pins[0]'s: a stack must not dress every plan
  // as the first one. Where the plans disagree, PinStackView draws neutral.
  const category = clusterCategory(cluster);
  const soonest = clusterIntentDate(cluster);
  // With no photo at all the stack collapses to a single 36pt disc, whose
  // tip sits where a single marker's does; a face row is 28pt.
  const hasFaces = faces.some((uri) => uri != null);
  // Everything the marker draws is in the key, or it never paints — the view
  // is a frozen bitmap outside the tracking window. City variant: `clock` is
  // the synthetic city Date, whose UTC read the plain ISO leg misreads.
  const later = isLaterCityDay(soonest, clock);
  const tracking = useMarkerTracking(
    `${selected}:${faces.join('|')}:${cluster.pins.length}:${category}:${later}`
  );
  return (
    <Marker
      coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
      anchor={MARKER_ANCHOR}
      centerOffset={hasFaces ? STACK_CENTER_OFFSET : MARKER_CENTER_OFFSET}
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
        category={category}
        selected={selected}
        later={later}
      />
    </Marker>
  );
}

/**
 * Several VENUES merged because the current zoom draws them under one
 * fingertip: a plain count bubble that splits on tap by zooming toward it.
 * The venue-level stack (ClusterMarker) keeps the faces; this one is
 * deliberately faceless — at a zoom where venues collide, who is going is
 * not answerable on the map.
 */
function CountBubbleMarker({
  screen,
  clock,
  onPress,
}: {
  screen: ScreenCluster;
  /** The browsed city's clock — the one authority for the later-day dim. */
  clock: Date;
  onPress: () => void;
}) {
  const pins = screenClusterPins(screen);
  const category = clusterCategory({ key: screen.key, lat: screen.lat, lng: screen.lng, pins });
  const soonest = pins.reduce(
    (min, pin) => (pin.intent_date < min ? pin.intent_date : min),
    pins[0].intent_date
  );
  // City variant, like every marker on this map: `clock` is the city's
  // synthetic Date, and the device-clock ISO leg is meaningless on it.
  const later = isLaterCityDay(soonest, clock);
  const tracking = useMarkerTracking(`${pins.length}:${category}:${later}`);
  return (
    <Marker
      coordinate={{ latitude: screen.lat, longitude: screen.lng }}
      anchor={MARKER_ANCHOR}
      centerOffset={MARKER_CENTER_OFFSET}
      displayPriority="required"
      zIndex={2}
      tracksViewChanges={tracking}
      accessibilityRole="button"
      accessibilityLabel={`${countOf(pins.length, 'plan')} in this area`}
      accessibilityHint="Zooms in to separate them"
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}>
      <PinStackView faces={[]} count={pins.length} category={category} later={later} />
    </Marker>
  );
}

type MapMode = 'browse' | 'place' | 'detail';

/** When this JS session started, for the first-session strip. */
const SESSION_START_MS = Date.now();
/** Clock slack between the server stamping onboarding and this device. */
const SESSION_GRACE_MS = 10 * 60_000;
/**
 * The dock button's height at the default text size — the seed for the
 * measured height, and the style's minHeight. The button grows with Dynamic
 * Type, so anything anchored on the bare constant slid under it at the
 * accessibility sizes.
 */
const DOCK_MIN_HEIGHT = 52;
/**
 * How far apart a split must land a bubble's widest member pair, in points:
 * comfortably past SCREEN_CLUSTER_PT, and past 2x it — the greedy screen
 * pass could still chain two markers each 44pt from a shared seed.
 */
const SPLIT_CLEAR_PT = 110;

export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Measured against Dynamic Type, not the 50pt constant: at the AX sizes
  // the native bar grows upward, and everything anchored on the constant
  // slid underneath it — including the Drop a pin dock. Everything above the
  // dock now anchors on `messageSlot`, one derived constant, instead of the
  // two hand-tuned offsets that used to overlap.
  const dockBottom = useTabDockBottom();
  const mapRef = useRef<MapView>(null);
  // MapKit's camera is outside Reanimated's reach, so Reduce Motion is
  // honoured by hand on the two long flights (city switch, address search).
  const { reduceMotion } = useAccessibilitySettings();
  // Only so the points of interest can be turned off in a later commit than
  // the map type. See features/pins/basemap.
  // The founder's launch cities, for the one thing they still decide on this
  // screen: which city a BUSINESS's map opens on. Travelers browse the rail.
  const launchCitiesQuery = useLaunchCities();
  const launchCities = launchCitiesQuery.data ?? [];
  // The rail: the launch cities plus any city whose visible plans clear its
  // k, most plans first, each carrying its count.
  const featuredQuery = useFeaturedCities();
  // Memoised, because the resolution below keys on it and `?? []` would be
  // a fresh array on every render until the query answers.
  const featured = useMemo(() => featuredQuery.data ?? [], [featuredQuery.data]);
  // Which city, in order of how explicitly it was asked for: the persisted
  // choice (any city: a chip, a search, a pin that landed elsewhere), then
  // the soonest trip's city, then the featured city on the device's own
  // clock zone (Intl only — NEVER a location read, §7 rule 2), then the
  // first on the rail. Held back until the stored choice has been read, or
  // the map would mount on the fallback and flip cities a frame later.
  const chosenCity = useCityChoice((s) => s.city);
  const chosenCityId = chosenCity?.city_id ?? null;
  const cityHydrated = useCityChoice((s) => s.hydrated);
  const chooseCity = useCityChoice((s) => s.chooseCity);
  const { data: myTrips = [] } = useMyTrips();
  // A place is not a traveler and may not drop a 72-hour pin (§7 rule 8, six
  // BEFORE INSERT triggers). Without this the owner filled in the whole pin
  // form and was refused by a raw database alert at the end of it.
  const ownBusiness = useOwnBusiness().data ?? null;
  const isBusiness = ownBusiness != null;
  // Which chip on this map is theirs. Every listing was drawn identically,
  // so an owner looking for their own business on their own map had to guess.
  const ownBusinessId = ownBusiness?.id ?? null;
  // For a business the LISTING owns the city. Resolved here, AHEAD of
  // pickBrowsingCity, never seeded into the persisted store: the store is
  // what the chips write, the rail is hidden for a business, and a persisted
  // pre-signin chip tap (or any stored choice) would otherwise pin the owner
  // to the wrong city with no control left to undo it — while a store write
  // of the listing's city would make map_viewed report `explicit: true` for
  // a choice the owner never made. Launch-city membership is checked here so
  // a deactivated city falls through to the ordinary resolution.
  const businessCityId =
    ownBusiness?.city_id != null && launchCities.some((c) => c.city_id === ownBusiness.city_id)
      ? ownBusiness.city_id
      : null;
  const today = toISODate(new Date());
  // Memoised on its inputs, because a city resolved from a trip is built
  // from the trip's row and the object has to hold still between renders.
  const browsing = useMemo(
    () => pickBrowsingCity(featured, myTrips, today, chosenCity, deviceTimezone()),
    [featured, myTrips, today, chosenCity]
  );
  const businessLaunchCity =
    businessCityId != null ? launchCities.find((c) => c.city_id === businessCityId) : undefined;
  const businessBrowseCity = useMemo(
    () => (businessLaunchCity ? browseCityFromLaunch(businessLaunchCity) : undefined),
    [businessLaunchCity]
  );
  const activeCity: BrowseCity | undefined = cityHydrated
    ? (businessBrowseCity ?? browsing.city ?? undefined)
    : undefined;
  const activeCityId = activeCity?.city_id ?? null;
  // What the rail draws: the featured cities, with the browsed city in front
  // of them when it is not one of them. A city reached by search, or by a
  // pin that landed a continent away, still needs a lit chip - a rail with
  // nothing selected reads as a map with no city.
  const railCities = useMemo(
    () =>
      activeCity && !featured.some((c) => c.city_id === activeCity.city_id)
        ? [activeCity, ...featured]
        : featured,
    [featured, activeCity]
  );
  // Everything the map is narrowed by, behind one control. It used to be
  // three date chips and nothing else, which filtered the dimension people
  // asked about least and offered no way to ask about who is on the map at
  // all. See features/pins/filters.
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The browsed city's wall clock — the ONE authority for the word "today"
  // on this screen. At 20:00 in London it is 03:00 tomorrow in Bangkok, and
  // a device-clock Today filtered to a night that had already ended.
  // Recomputed per render (renders are event-driven here); the derivations
  // below memo on its calendar DAY, so identity churn stops at the strings.
  const cityClock = cityClockNow(activeCity?.timezone ?? null, activeCity?.cities.lng ?? null);
  const cityDayISO = toISODate(cityClock);
  const deviceDayISO = toISODate(new Date());
  // One date for the heat RPC, which takes a single day (the city's), and
  // the set of dates the pin markers accept. A set, because THREE clocks now
  // meet here: the city's day leads, and the device-local and UTC days that
  // write intent_date stay matched - see filterDates.
  const filterISO = heatDay(filters.day, new Date(), cityClock);
  const filterSet = useMemo(
    () => daysFor(filters.day, new Date(), cityClock),
    // Day-level keys on purpose: the clock objects are new every render, but
    // the sets they produce only change when a calendar day rolls over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.day, cityDayISO, deviceDayISO]
  );
  const pinsQuery = useMapPins(activeCityId);
  const { data: allPinRows = [], isSuccess: pinsLoaded } = pinsQuery;
  // Both map feeds return intent_time and business_id since 20260902190000.
  // src/lib/database.types.ts is not this package's file, so the row type
  // does not know that yet and the widening happens here, once, at the
  // boundary rather than at every read. Delete the cast when CityPinRow
  // carries the two columns.
  const allPins = allPinRows as MapPin[];
  // Both halves of the heat ask: the day-filtered layer, and the all-days
  // pool it may fall back to (the same physical query when no day is chosen,
  // so the keys collide and react-query dedupes). Error and pending are read
  // off the query — a failed heatmap and a genuinely quiet city used to be
  // indistinguishable.
  const heatQuery = useMapHeat(activeCityId, filterISO);
  const allDaysHeatQuery = useMapHeat(activeCityId, null);
  const heatShown = showsHeat(filters);
  const { rows: heatRows, fallback: heatFallback } = heatWithFallback(
    filterISO != null,
    heatQuery.data ?? [],
    allDaysHeatQuery.data ?? []
  );
  const heatCells = useMemo(() => mergeHeatCells(heatRows), [heatRows]);
  // WHERE THIS CITY IS USUALLY BUSY, under the live layer. Live heat only
  // knows about pins that exist right now and pins burn out within 72 hours,
  // so a quiet Tuesday in Lisbon drew nothing at all — the layer failing the
  // brief's own test for it. The server answers for the city's own weekday
  // and hour band and re-applies the k-threshold twice (every stored bucket
  // already cleared it live, and a cell needs k separate days before it is
  // returned), so there is nothing for this screen to threshold and nothing
  // for it to pass. It is not day-filtered: "usually" is a habit, not a date.
  const historyQuery = useHeatHistory(activeCityId);
  const historyCells = useMemo(() => mergeHeatCells(historyQuery.data ?? []), [historyQuery.data]);
  // The glow explanation, only when a glow is actually drawn and drawn
  // unlabelled — the fallback branch carries its own footnote. The
  // remembered layer counts as a glow: it is dimmer, but it is exactly as
  // unlabelled, and its sentence is a different one (below).
  const legend = useHeatLegend(
    heatShown && (heatCells.length > 0 || historyCells.length > 0) && !heatFallback
  );
  const isGuest = useIsGuest();
  // A guest has no setting of their own, and the hook is disabled without a
  // user id, so this falls back to 'everyone' for them.
  const { data: audience = 'everyone' } = useOwnVisibility();
  // For the two moments the message slot now carries: the first-session
  // strip (keyed on onboarding_completed_at falling inside this session) and
  // the be-first follow-up on the viewer's own solitary pin.
  const ownUserId = useOwnUserId();
  const { data: ownProfile } = useOwnProfile();
  const askPrimer = usePushPrimer((s) => s.ask);
  const canAskPrimer = usePushPrimer((s) => s.canAsk);
  const [firstPinAsked, setFirstPinAsked] = useState(false);
  // Whether the first-pin banner's "Turn on notifications" action would
  // actually present anything. useCreatePin already asked on post, so for
  // exactly the person this banner targets the ask is usually spent — and a
  // tap the primer store would silently swallow must not be offered.
  const [firstPinAskable, setFirstPinAskable] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  // Places are the third marker family, and they are quiet on purpose:
  // people stack on top of places, which is the right sentence for this app.
  const { data: places = [] } = useCityBusinesses(activeCityId);
  // One at a time. Two chips stacked over a map is furniture, so the places
  // one waits until the heat one has been read and dismissed.
  // (ownBusiness / isBusiness / ownBusinessId live up beside the city
  // resolution now: the listing's city is an input to activeCityId.)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  // Every other gate in the app states its reason before it asks. Dropping a
  // pin was the one that did not: it teleported a guest to an email form with
  // no explanation of what had just happened to them.
  // Which gate is open, if any. Two of them now: dropping a pin, and joining
  // somebody else's plan. One piece of state rather than two booleans,
  // because only one sheet may ever be up.
  const [gate, setGate] = useState<'drop' | 'join' | null>(null);
  // The rail's search chip, and what somebody typed into it. Any of the
  // ~49,000 cities in the reference table can be browsed: the rail is where
  // the plans are, not the list of places a person is allowed to go.
  const [citySearchOpen, setCitySearchOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const citySearch = useCitySearch(citySearchOpen ? cityQuery : '');
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
  // `showsBusinesses(filters)` is the second way that happens, and the one a
  // business owner reaches first: their filter sheet offers "Businesses" as a
  // checkbox, and unticking it empties the map of chips while this legend went
  // on pointing at them.
  const placesLegend = usePlacesLegend(
    !cityScale && showsBusinesses(filters) && places.length > 0 && !legend.visible
  );
  // Whether the owner's own chip is actually drawn, which is not the same as
  // being a business: a listing waiting on its email code is not in
  // city_businesses yet. The legend below teaches the ring, and a sentence
  // about a ring that is not on the map is the same contradiction the legend
  // exists to avoid.
  const ownChipOnMap = ownBusinessId != null && places.some((p) => p.id === ownBusinessId);
  // The owner's own row of city_businesses, for the dock button's label:
  // has_live_post is what separates "say what's on tonight" from "update it".
  const ownPlace = ownBusinessId != null ? places.find((p) => p.id === ownBusinessId) : undefined;
  // The one thing a hostel owner wants from a map of their city — see who is
  // around, then say what is on tonight — gets a dock only once the listing
  // is live: posting into a listing nobody can see would be a lie of a
  // button, so until then the own-listing card below stands in its place.
  const businessDockShown = isBusiness && ownBusiness?.state === 'listed';
  // The owner's own chip is missing from their own map, and the code knows
  // why: my_business() carries the state. Only non-listed states — a listed
  // chip answers for itself, and while city_businesses is still loading a
  // card would flash over a map that is about to be fine.
  const listingMissing =
    isBusiness && ownBusiness != null && ownBusiness.state !== 'listed' && !ownChipOnMap;
  const ownListingNotice = ownBusiness != null ? listingNotice(ownBusiness.state) : null;

  // Make a city current: state, cleared selections, and the camera, in one
  // move. Hoisted above the config early-return because the pending-intent
  // replay effect below has to close over it from the hooks section.
  const applyCity = (city: BrowseCity) => {
    chooseCity(city);
    setSelectedPinId(null);
    // The venue stack's SHEET heals itself — openVenue resolves to null the
    // moment the city's list reloads — but the raw key would linger, and the
    // camera-fit guard reads the raw key: a stale one from the last city
    // would hold the new city's first fit hostage. Cleared like the others.
    setVenueKey(null);
    // The place card does not heal at all: it is handed a bare id and
    // `business-detail` is cached under that id alone, so without this the
    // card for a bar in Bangkok stays parked at the bottom of the Lisbon map,
    // with Join the chat and Message still wired to it.
    setSelectedPlaceId(null);
    // A city switch is the longest flight the camera makes, and Reanimated
    // never sees it - so Reduce Motion is honoured here by hand: the same
    // region, arrived at instantly.
    mapRef.current?.animateToRegion(
      {
        latitude: city.cities.lat,
        longitude: city.cities.lng,
        latitudeDelta: 0.09,
        longitudeDelta: 0.09,
      },
      reduceMotion ? 0 : 350
    );
  };

  // A business account's map opens on its own city — RESOLVED, not seeded:
  // businessCityId (above) outranks pickBrowsingCity, and nothing is written
  // into the store the chips share. What is left for an effect is the
  // camera: useOwnBusiness is async, so the resolution flips activeCityId
  // only after the MapView has already mounted on initialRegion — a map
  // labelled with the right city still parked over the wrong one is the same
  // wrong city with extra steps. One shot, the flight applyCity makes minus
  // the chooseCity write; deferred a tick like the replay below, because a
  // synchronous setState cascade inside an effect is a lint error and a real
  // render hazard. The ROW is the dependency, not the launchCities array —
  // the array is re-created while the query loads and would churn the deps.
  const flownToBusinessCity = useRef(false);
  const businessCity =
    businessCityId != null ? launchCities.find((c) => c.city_id === businessCityId) : undefined;
  useEffect(() => {
    if (flownToBusinessCity.current || businessCity == null) {
      return;
    }
    flownToBusinessCity.current = true;
    const timer = setTimeout(() => {
      // The same clears applyCity makes: a selection made over the wrong
      // city during the resolution's brief window must not survive the trip.
      setSelectedPinId(null);
      setVenueKey(null);
      setSelectedPlaceId(null);
      mapRef.current?.animateToRegion(
        {
          latitude: businessCity.cities.lat,
          longitude: businessCity.cities.lng,
          latitudeDelta: 0.09,
          longitudeDelta: 0.09,
        },
        reduceMotion ? 0 : 350
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [businessCity, reduceMotion]);

  // THE GUEST'S TAP, CARRIED ACROSS THE ACCOUNT WALL. The one context that
  // used to survive signup was a group-invite token (PendingInviteHandoff);
  // the map replays its own two origins the same way: select the city, then
  // the pin card (below, once the rows land), or re-enter place mode at the
  // region they had panned to. Cleared BEFORE acting - inviteHandled's own
  // rule - so backing out of the replayed screen cannot push it back on.
  const pendingIntent = useAuthStore((s) => s.pendingIntent);
  const intentHandled = useAuthStore((s) => s.intentHandled);
  // Whether the map is the screen on stage. The replay below waits for it:
  // a guest's session is upgraded at signup's FIRST step (updateUser on the
  // anonymous session), so an effect keyed on isGuest alone replayed the
  // intent into a map that was still covered by thirteen more signup
  // screens - place mode entered in the dark, and gone by the time the tabs
  // came back. The intent is consumed only once a person can see the result.
  const focused = useIsFocused();
  const listingIntent = useAuthStore((s) => s.listingIntent);
  // Part way through listing a business, from the column as well as the
  // store flag: business-signup clears the flag on mount, so by the time
  // "Finish this later" lands an owner-to-be on this map only the column
  // still says so. Run 113 replayed a guest's drop-pin intent for exactly
  // that account and left it in place mode, on a map whose dock it may not
  // use. The tabs handoff lets the intent go for them (app/(tabs)/_layout).
  const wantsBusiness = useWantsBusiness();
  const intentRemembered = useAuthStore((s) => s.intentRemembered);
  // The tick that carries the replay across its own clear. Held in a ref and
  // cancelled ONLY on unmount, never by the replay effect's cleanup: that
  // effect consumes the intent first, and a store write inside a passive
  // effect re-renders this screen before React returns to the event loop -
  // so a cleanup keyed on the intent ran, and cleared the 0ms timer, before
  // the timer could fire. Every replay was cancelled by the act of recording
  // that it had happened (runs 109-112, the onboarding tour's guarded tail;
  // replay-outlives-its-clear.test.tsx pins the mechanism).
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (replayTimer.current != null) {
        clearTimeout(replayTimer.current);
      }
    },
    []
  );
  // Which plan somebody signed-out tried to JOIN, so the join gate can
  // record it: by the time that gate's navigate runs, the card is closed and
  // selectedPin is gone.
  const joinGatePinId = useRef<string | null>(null);
  // The pin half of a replay waits for the city's rows: set here, consumed
  // by the effect below once pinsLoaded is true for the right city.
  const replayPin = useRef<{ cityId: number; pinId: string } | null>(null);

  // The plan list's detent lives HERE, not inside the list: an expanded list
  // buries whatever the message slot rendered under it, so the slot-clear
  // condition and the heatmap-view gate both have to see it.
  const [planDetent, setPlanDetent] = useState<PlanListDetent>('peek');
  // The dock button's real height. minHeight 52 at the default text size, but
  // it grows with Dynamic Type, and the plan list's peek used to anchor on
  // the constant and cover the dock's top edge at the accessibility sizes.
  const [dockHeight, setDockHeight] = useState(DOCK_MIN_HEIGHT);
  // The plan list's peek strip, measured by the list and held HERE for the
  // same reason the detent is: the message strip anchors on the card's real
  // top edge, and PlanList remounts on every mode change, so a measurement
  // kept inside it would re-seed to the constant on every return from
  // placing a pin.
  const [planPeekHeight, setPlanPeekHeight] = useState(PLAN_LIST_PEEK);
  // The drop-a-pin flow lives on this map, not a separate screen: browse →
  // place (map pans under a fixed pin) → detail (form sheet over the map).
  const [mode, setMode] = useState<MapMode>('browse');
  const [lifted, setLifted] = useState(false);
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [searchedPlace, setSearchedPlace] = useState<LocalSearchResult | null>(null);
  // What the map can call the spot under the placement pin, so the pill can
  // name it BEFORE "Pin here" asks anyone to commit to it. Reverse-geocoding
  // a coordinate the user chose on a map reads nobody's position (§7 rule 2):
  // no permission is requested, and this is the same call the pin form
  // already makes today, just before the commit instead of after.
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  // The geocoder answered and the answer was NOTHING: open water, a
  // motorway, nowhere. Its own state rather than a magic label value,
  // because it also disables Pin here - the one thing worse than a plan on
  // a bridge is committing it there. A network failure is NOT this: the
  // catch below degrades to the plain pill and an enabled button.
  const [nothingHere, setNothingHere] = useState(false);
  // The venues MapKit knows under the placement pin, offered as chips so the
  // drag-the-map path can produce a pin as good as the search path: a real
  // name and a real category, no question asked. Empty means the row is
  // ABSENT (over water, sparse regions, or a binary without nearbyAsync);
  // an empty row would be a promise with nothing in it.
  const [nearbyVenues, setNearbyVenues] = useState<LocalSearchResult[]>([]);
  // The thud gate: entering place mode and flying to a search result are
  // camera moves the app makes, and the pin's drop haptic means "you placed
  // it here". See features/pins/place-mode. useState, not a ref: the gate is
  // handed to a prop during render, and the refs lint is right that a
  // ref.current read there is a hazard.
  const [dropGate] = useState(() => createDropGate());
  // Guards on the geocoder, because CLGeocoder rate-limits and starts
  // failing under rapid panning: a seq counter drops any response that is
  // not the newest (the use-place-search pattern), and shouldGeocode holds
  // the 800ms floor and the 15m distance rule.
  const geocodeSeq = useRef(0);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocoded = useRef<{ lat: number; lng: number } | null>(null);
  const lastGeocodeAt = useRef(0);
  const lastRegion = useRef<Region | null>(null);
  // The settled region AS STATE, unlike lastRegion above: the plan list
  // re-sorts by distance from the centre, the screen-space cluster pass
  // needs the zoom, and the way-home pill needs the drift — all of which
  // have to reach React. Only updated once the camera has moved a real
  // distance or zoomed a real step, so a nudge or a rubber-band settle does
  // not re-render every marker on the map.
  const [settledRegion, setSettledRegion] = useState<Region | null>(null);

  // `new Date().getTime()`, matching how the rest of this codebase reads the
  // clock in event paths — these run from map events and timers, never during
  // render.
  const namePlaceCentre = (lat: number, lng: number) => {
    if (
      !shouldGeocode({
        last: lastGeocoded.current,
        next: { lat, lng },
        lastAtMs: lastGeocodeAt.current,
        nowMs: new Date().getTime(),
      })
    ) {
      return;
    }
    const mine = ++geocodeSeq.current;
    lastGeocoded.current = { lat, lng };
    lastGeocodeAt.current = new Date().getTime();
    // The venues under the pin ride the SAME seq, floor and distance guards
    // as the geocode, so the two cannot each fire on every frame of a pan.
    // Sorted here because MKLocalPointsOfInterestRequest promises radius,
    // not order, and "the two or three NEAREST" is the offer.
    nearbyPlaces({ latitude: lat, longitude: lng, radiusMeters: NEARBY_RADIUS_M })
      .then((venues) => {
        if (mine !== geocodeSeq.current) {
          return;
        }
        setNearbyVenues(
          [...venues]
            .sort(
              (a, b) =>
                metersBetween(lat, lng, a.latitude, a.longitude) -
                metersBetween(lat, lng, b.latitude, b.longitude)
            )
            .slice(0, NEARBY_SHOWN)
        );
      })
      .catch(() => {
        // A lookup that failed offers nothing, quietly: the name pill and
        // the plan-text category guess are the fallback, not an error.
        if (mine === geocodeSeq.current) {
          setNearbyVenues([]);
        }
      });
    Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
      .then((places) => {
        if (mine !== geocodeSeq.current) {
          return;
        }
        const place = places[0];
        const label = place
          ? [place.name ?? place.street, place.district ?? place.city].filter(Boolean).join(', ')
          : '';
        setPlaceLabel(label || null);
        // A resolved empty answer is a fact about the spot; say it and hold
        // the button. A new settle re-asks and clears it.
        setNothingHere(!label);
      })
      .catch(() => {
        // No name is fine; the pill falls back to its own words. But clear
        // the distance memory: leaving the stamp would refuse every retry
        // within 15m of this spot forever, so one offline moment pinned the
        // pill to "Drop it here" until the person panned away. The time
        // floor still applies.
        lastGeocoded.current = null;
        // Degrade to nothing, never to a refusal: a device that cannot
        // geocode right now must still be able to pin.
        setNothingHere(false);
      });
  };

  const stopNamingPlaceCentre = () => {
    if (geocodeTimer.current) {
      clearTimeout(geocodeTimer.current);
      geocodeTimer.current = null;
    }
    geocodeSeq.current += 1;
    lastGeocoded.current = null;
    lastGeocodeAt.current = 0;
  };

  // The tab can unmount with a geocode timer armed; the cleanup drops it and
  // bumps the seq so an in-flight response is discarded.
  useEffect(() => {
    return () => stopNamingPlaceCentre();
  }, []);

  /**
   * Nudge the camera so a marker stays visible above the card that is about
   * to open over the bottom of the map. One function for all three marker
   * families and the plan list, so every card behaves alike. Skipped when
   * the marker is already north of the region centre: the card opens at the
   * bottom, so a marker in the top half already clears it, and animating
   * anyway would fight the person's own framing.
   */
  const nudgeAbove = (lat: number, lng: number) => {
    const region = lastRegion.current;
    if (region && lat > region.latitude) {
      return;
    }
    const delta = region?.latitudeDelta ?? 0.05;
    mapRef.current?.animateToRegion(
      {
        latitude: lat - delta * 0.12,
        longitude: lng,
        latitudeDelta: delta,
        longitudeDelta: region?.longitudeDelta ?? delta,
      },
      300
    );
  };

  /**
   * Into place mode: browse -> place, camera zoomed a step toward street
   * precision. `at` is for the signup replay, which re-enters at the region
   * the guest had panned to; a live tap reads the settled region instead.
   */
  const enterPlaceMode = (at?: Region | null) => {
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
    setPlaceLabel(null);
    setNothingHere(false);
    setNearbyVenues([]);
    stopNamingPlaceCentre();
    const region = at ?? lastRegion.current;
    setPlaceCoords({
      lat: region?.latitude ?? activeCity.cities.lat,
      lng: region?.longitude ?? activeCity.cities.lng,
    });
    setMode('place');
    // Zoom in a step: placement wants street precision, browsing wants area.
    // The app's own move, so the pin's landing must not thud like a choice.
    dropGate.markProgrammatic();
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

  // THE REPLAY ITSELF, one tick deferred: it flips several pieces of screen
  // state at once (city, then selection or mode), and a synchronous cascade
  // inside an effect is both a lint error and a real render hazard. The
  // clear (intentHandled) is synchronous and FIRST, so backing out of the
  // replayed screen cannot push it back on.
  useEffect(() => {
    if (
      pendingIntent == null ||
      // The Travelers tab replays its own origin (see app/(tabs)/_layout).
      pendingIntent.kind === 'traveler' ||
      isGuest ||
      isBusiness ||
      wantsBusiness ||
      listingIntent ||
      !focused ||
      !cityHydrated ||
      featured.length === 0
    ) {
      return;
    }
    intentHandled();
    const intent = pendingIntent;
    // The city they were looking at: on the rail, or the one they had
    // chosen. A guest can only have been browsing one of those two.
    const target =
      featured.find((c) => c.city_id === intent.cityId) ??
      (chosenCity?.city_id === intent.cityId ? chosenCity : null);
    if (target == null) {
      // The city left the rail while they signed up. Nothing honest to
      // replay; the resolved default stands.
      return;
    }
    replayTimer.current = setTimeout(() => {
      replayTimer.current = null;
      applyCity(target);
      if (intent.kind === 'pin' && intent.pinId != null) {
        replayPin.current = { cityId: intent.cityId, pinId: intent.pinId };
      } else if (intent.kind === 'drop-pin') {
        // The ordinary door, at the remembered region: enterPlaceMode marks
        // its own camera move so the pin's landing does not thud.
        enterPlaceMode(intent.region);
      }
    }, 0);
    // NO CLEANUP HERE. intentHandled() above re-runs this effect before the
    // timer fires, and a cleanup that cleared the timer cancelled the replay
    // every time (see replayTimer, which is cleared on unmount only).
    // applyCity/enterPlaceMode are stable per render; the guards above make
    // this one-shot, so the exhaustive list would only widen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingIntent,
    isGuest,
    isBusiness,
    wantsBusiness,
    listingIntent,
    focused,
    cityHydrated,
    featured,
  ]);

  // The data-dependent half: the card can only open once the city's pins are
  // back, and the pin may have burned out while signup happened. Degrades
  // SILENTLY to the selected city - never an error at the end of thirteen
  // screens.
  useEffect(() => {
    const target = replayPin.current;
    if (target == null || activeCityId !== target.cityId || !pinsLoaded) {
      return;
    }
    replayPin.current = null;
    const pin = allPins.find((p) => p.id === target.pinId);
    if (pin == null) {
      return;
    }
    const timer = setTimeout(() => {
      setSelectedPinId(pin.id);
      nudgeAbove(pin.lat, pin.lng);
    }, 0);
    return () => clearTimeout(timer);
    // nudgeAbove reads refs and is stable per render; the consumed ref makes
    // this one-shot.
  }, [pinsLoaded, allPins, activeCityId]);

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
  // Second pass, in screen space: venue clusters that would overlap at the
  // settled zoom merge into one count bubble. Keyed on member ids, so the
  // bubbles keep their identity — and their bitmaps — as the camera moves.
  // Each axis scaled by its own screen dimension: latitudeDelta spans the
  // HEIGHT (see clusterByScreen).
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const screenClusters = useMemo(
    () => clusterByScreen(clusters, settledRegion, screenWidth, screenHeight),
    [clusters, settledRegion, screenWidth, screenHeight]
  );
  const openVenue = useMemo(() => {
    const venue = clusters.find((cluster) => cluster.key === venueKey) ?? null;
    if (venue != null) {
      return venue;
    }
    // A count bubble whose members no zoom can separate (splitBubble's
    // degenerate fallback) opens as one stack: the same sheet, every plan
    // the bubble holds.
    const bubble = venueKey != null ? screenClusters.find((s) => s.key === venueKey) : null;
    return bubble != null
      ? { key: bubble.key, lat: bubble.lat, lng: bubble.lng, pins: screenClusterPins(bubble) }
      : null;
  }, [clusters, screenClusters, venueKey]);
  const mapCentre = useMemo(
    () => (settledRegion ? { lat: settledRegion.latitude, lng: settledRegion.longitude } : null),
    [settledRegion]
  );
  // Everything the markers currently draw, for the camera fit and for the
  // panned-away check: the pins after the filters, plus the business chips
  // when they are ticked (they only draw past city scale, matching :1233).
  const markerPoints = useMemo(
    () => [
      ...pins.map((pin) => ({ lat: pin.lat, lng: pin.lng })),
      ...(showsBusinesses(filters) && !cityScale
        ? places.map((place) => ({ lat: place.lat, lng: place.lng }))
        : []),
    ],
    [pins, places, filters, cityScale]
  );
  // WHERE HOME IS: the frame the fit below lands on once this city's rows
  // are in, the city's own box until then (and while the query is still
  // showing the last city's rows, which would otherwise be framed as this
  // one's home for a beat and summon the pill mid-flight). The pill measures
  // from here and lands here; see homeRegion for why not the centroid.
  const home = useMemo(
    () =>
      activeCity == null
        ? null
        : homeRegion(pinsLoaded && !pinsQuery.isPlaceholderData ? markerPoints : [], {
            lat: activeCity.cities.lat,
            lng: activeCity.cities.lng,
          }),
    [activeCity, pinsLoaded, pinsQuery.isPlaceholderData, markerPoints]
  );
  // Fit the camera to its own data: on first arrival, on a city switch once
  // the new city's rows land, and on every filter change — a narrowed map
  // must re-frame what survived or it reads as an emptied city. Never while
  // a card is open (the select nudge owns the camera then), never in place
  // mode (the map is a viewfinder), and never past city scale.
  const lastFitKey = useRef<string | null>(null);
  useEffect(() => {
    if (!pinsLoaded || activeCityId == null) {
      return;
    }
    const key = `${activeCityId}:${filters.day}:${filters.kinds.join()}:${filters.categories.join()}`;
    if (lastFitKey.current === key) {
      return;
    }
    // The key is consumed only once the fit actually runs: a fit occasion
    // that arrives while a card, a stack, or place mode owns the camera
    // stays pending until the blocker clears, instead of being marked done
    // and skipped forever.
    if (
      mode !== 'browse' ||
      selectedPinId != null ||
      venueKey != null ||
      selectedPlaceId != null ||
      cityScale
    ) {
      return;
    }
    lastFitKey.current = key;
    const region = fitRegion(markerPoints);
    if (region) {
      mapRef.current?.animateToRegion(region, reduceMotion ? 0 : 350);
    }
  }, [
    pinsLoaded,
    activeCityId,
    filters,
    markerPoints,
    mode,
    selectedPinId,
    venueKey,
    selectedPlaceId,
    cityScale,
    reduceMotion,
  ]);

  // §6 metrics: map DAU (every city view, including the initial one) and
  // heatmap views per session. One component serves both audiences, so the
  // guest flag rides along — map DAU is `guest = false` on this event
  // (docs/DASHBOARD.md), and without the tag both sides of the map-versus-
  // matching ratio are wrong in opposite directions.
  // Once per CITY, by ref: the deps carry isGuest only to read its current
  // value, and a guest upgrade flipping it in place must not recount a city
  // view that already happened.
  //
  // Captured UNCONDITIONALLY once the city list has settled: `explicit`
  // separates a chosen city from a defaulted attribution (every silent
  // default used to be filed under Bangkok), and a user the resolution finds
  // no city for at all — the list failed, or came back empty — is counted
  // with `city_id: null` rather than invisible. Interest from outside the
  // launch cities is the growth signal; a metric that is zero by
  // construction is worse than none.
  const viewedCities = useRef<Set<number>>(new Set());
  const citiesSettled = featuredQuery.isSuccess || featuredQuery.isError;
  useEffect(() => {
    if (!cityHydrated || !citiesSettled) {
      return;
    }
    const key = activeCityId ?? -1;
    if (viewedCities.current.has(key)) {
      return;
    }
    viewedCities.current.add(key);
    analytics.capture('map_viewed', {
      city_id: activeCityId ?? null,
      guest: isGuest,
      // A chip tap and nothing else. A business's city is resolved from its
      // listing (businessCityId outranks the store), so a stored choice —
      // theirs from before signup, or anybody's on this device — is not what
      // put this city on screen and must not report as one.
      explicit: businessCityId == null && chosenCityId != null,
    });
  }, [activeCityId, businessCityId, chosenCityId, cityHydrated, citiesSettled, isGuest]);
  // `heatmap_viewed`, not the old `heatmap_rendered`: that one fired when
  // heat DATA arrived, not when a person saw anything, so the founder metric
  // read healthy for a layer that had drawn zero pixels. A view needs pixels
  // on an uncovered map, once per city per session. `cells` stays as an
  // aggregate count only.
  const heatViewedCities = useRef<Set<number>>(new Set());
  // The RESOLVED entities where one exists (selectedPin, openVenue), never
  // the raw ids: the sheets themselves render off the resolved values, so a
  // stale id — a venue key surviving a city switch, a pin the filters just
  // removed — must not count as cover for a sheet that is not on screen.
  // The place card is handed its bare id (it fetches its own row), so the
  // raw id is exactly what mounts it.
  const sheetCovered =
    selectedPin != null ||
    openVenue != null ||
    selectedPlaceId != null ||
    filtersOpen ||
    gate != null;
  // Whether the plan list is on screen at all, and whether it stands past
  // its peek. Past the peek the list is itself the thing covering the map:
  // slot content under it is buried, and heat pixels under it are unseen.
  const planListShown =
    mode === 'browse' &&
    activeCity != null &&
    (pins.length > 0 || listableBusinesses(places, isBusiness, ownBusinessId).length > 0);
  // Reads sheetCovered, never mapCovered: the fold condition must not read
  // the expansion it forces, or the list would collapse itself the moment
  // it opened.
  const planListCollapsed = sheetCovered;
  const planListExpanded = planListShown && !planListCollapsed && planDetent !== 'peek';
  const mapCovered = sheetCovered || planListExpanded;

  // WHO OWNS THE MESSAGE STRIP. Exactly one thing renders in the slot above
  // the plan list, on one explicit priority (features/pins/message-slot);
  // every banner and chip below reads `slot` instead of its own gates. The
  // strip clears entirely while any sheet covers the map.
  const hasOwnPin = ownUserId != null && allPins.some((pin) => pin.user_id === ownUserId);
  const onboardedAtMs = ownProfile?.onboarding_completed_at
    ? Date.parse(ownProfile.onboarding_completed_at)
    : null;
  // "Just finished signup", NOT "has finished signup" — the latter is true
  // forever. Inside this app session, with a little grace for the gap
  // between the server stamping the row and this device's clock.
  const firstSession =
    !isBusiness &&
    !isGuest &&
    !hasOwnPin &&
    onboardedAtMs != null &&
    onboardedAtMs >= SESSION_START_MS - SESSION_GRACE_MS;
  // The person who took "Be the first" up on it, alone with their pin. From
  // allPins, never the filtered array: a filter that leaves only my pin
  // visible must not assert "You're first" over a non-empty city. Seeded
  // rows are our picks, not company — hasOwnPin's own exclusion, via their
  // null user_id. The pin itself is kept so the banner's promise can match
  // what the pin can actually receive (a join, or a message).
  const ownOnlyPin = useMemo(() => {
    if (isBusiness || ownUserId == null) {
      return null;
    }
    const travelerPins = allPins.filter((pin) => !pin.seeded);
    return travelerPins.length === 1 && travelerPins[0].user_id === ownUserId
      ? travelerPins[0]
      : null;
  }, [allPins, isBusiness, ownUserId]);
  const ownPinIsOnlyPin = ownOnlyPin != null;
  // Whether the banner's notification action can actually present. Asked of
  // the primer store each time the banner arms: useCreatePin already asked
  // on post, and a tap ask() would silently swallow is not offered.
  useEffect(() => {
    if (!ownPinIsOnlyPin) {
      return;
    }
    let alive = true;
    void canAskPrimer('pin-posted').then((worth) => {
      if (alive) {
        setFirstPinAskable(worth);
      }
    });
    return () => {
      alive = false;
    };
  }, [ownPinIsOnlyPin, canAskPrimer]);
  const viewportEmpty =
    settledRegion != null &&
    pinsLoaded &&
    markerPoints.length > 0 &&
    !anyInRegion(markerPoints, settledRegion);
  // From home, not from the city's centroid: the app's own framing of a
  // spread-out city used to count as having drifted (homeRegion).
  const farFromCity =
    home != null &&
    mapCentre != null &&
    metersBetween(mapCentre.lat, mapCentre.lng, home.latitude, home.longitude) > FAR_FROM_CITY_M;
  const emptyCity =
    pinsLoaded &&
    pins.length === 0 &&
    // Business chips answering the filters are content; the banner is not.
    (!isBusiness || !(!cityScale && showsBusinesses(filters) && places.length > 0));
  const slot =
    activeCity != null && mode === 'browse' && !mapCovered
      ? chooseSlot({
          'pins-error': pinsQuery.isError,
          'heat-error': heatShown && heatQuery.isError,
          'own-listing': listingMissing,
          'empty-city': emptyCity,
          'viewport-empty': viewportEmpty && !farFromCity,
          'way-home': farFromCity,
          'first-session': firstSession,
          'first-pin': ownPinIsOnlyPin,
          'heat-fallback': heatShown && heatFallback && heatCells.length > 0,
          'heat-legend': legend.visible,
          'places-legend': placesLegend.visible,
        })
      : null;
  // The all-days fallback may never appear unlabelled (rule 6 in spirit: an
  // unlabelled fallback reports "busy tomorrow" from a pool that is not
  // tomorrow's). It is drawn only while its footnote owns the strip — the
  // day-filtered layer was empty anyway.
  const heatFallbackActive = heatFallback && slot === 'heat-fallback';
  // Memoised only so its identity is stable: the history layer below filters
  // against it, and a fresh array every render would rebuild that set on
  // every frame of a pan.
  const drawnHeatCells = useMemo(
    () => (!heatShown || (heatFallback && !heatFallbackActive) ? [] : heatCells),
    [heatShown, heatFallback, heatFallbackActive, heatCells]
  );
  const drawnHeatCellCount = drawnHeatCells.length;
  // Only where today has nothing to say. Two glows stacked on one square
  // would read as one brighter cell, and the brighter number would be a
  // count of two different things. Gated on the same Busy areas toggle: one
  // control for one idea, and the filter sheet is not this package's file.
  const drawnHistoryCells = useMemo(() => {
    if (!heatShown) {
      return [];
    }
    const live = new Set(drawnHeatCells.map((cell) => cell.key));
    return historyCells.filter((cell) => !live.has(cell.key));
  }, [heatShown, drawnHeatCells, historyCells]);
  // Which sentence the one-shot legend carries. Today leads when both layers
  // are drawn; on a quiet Tuesday the only glow on the map is the remembered
  // one and it must not be described as plans that exist. Never "nearby" and
  // never "busy now" in either: the map is scoped to a city chip that may be
  // a continent away, and this app does not say where anybody is.
  const heatLegendLine =
    drawnHeatCells.length > 0
      ? 'Glowing spots are where the plans are'
      : 'Dimmer spots are where this city is usually busy';
  useEffect(() => {
    if (
      activeCityId == null ||
      heatViewedCities.current.has(activeCityId) ||
      !heatViewReady({ cells: drawnHeatCellCount, covered: mapCovered, placing: mode !== 'browse' })
    ) {
      return;
    }
    heatViewedCities.current.add(activeCityId);
    analytics.capture('heatmap_viewed', { city_id: activeCityId, cells: drawnHeatCellCount });
  }, [activeCityId, drawnHeatCellCount, mapCovered, mode]);

  // Say the empty settle out loud: the empty-city banner is a card VoiceOver
  // is never told about, so a quiet city and a map that failed to load were
  // the same silence. The sentence mirrors whichever banner is on screen
  // (the business variant is suppressed while its chips answer the filters,
  // exactly like the card). Failures are announced by LoadError itself.
  useAnnounce(
    activeCity != null &&
      mode === 'browse' &&
      pinsLoaded &&
      !selectedPin &&
      pins.length === 0 &&
      // While the own-listing card holds the strip, announcing "nothing
      // pinned" over it would be the screen contradicting itself out loud.
      slot !== 'own-listing' &&
      (!isBusiness || !(!cityScale && showsBusinesses(filters) && places.length > 0))
      ? !isBusiness && audience !== 'everyone'
        ? `Nothing pinned for ${audienceInSentence(audience)} yet`
        : isDefault(filters)
          ? isBusiness
            ? `Nothing pinned in ${activeCity.cities.name} yet`
            : `No pins in ${activeCity.cities.name} yet`
          : 'Nothing matches your filters'
      : null
  );

  if (!isSupabaseConfigured) {
    return <PlaceholderScreen configError icon={{ ios: 'map.fill', android: 'map', web: 'map' }} />;
  }

  /**
   * Back to where the app framed this city's plans. The way-home pill and a
   * tap on the chip that is already lit both land here, and here is what
   * the pill measures from, so neither can land somewhere that summons the
   * pill again (the city's centroid did, for Denpasar).
   */
  const goHome = () => {
    if (home == null) {
      return;
    }
    setSelectedPinId(null);
    setVenueKey(null);
    setSelectedPlaceId(null);
    mapRef.current?.animateToRegion(home, reduceMotion ? 0 : 350);
  };

  /** The chip-tap path: the same move as applyCity, chosen by a person. */
  const selectCity = (city: BrowseCity) => {
    // The lit chip again is a recentre, not a switch: home, and no event.
    if (city.city_id === activeCityId) {
      goHome();
      return;
    }
    applyCity(city);
    // The other half of the attribution fix: a switch is an event of its
    // own, so the funnel can tell "chose Lisbon" from "defaulted there".
    analytics.capture('city_switched', { city_id: city.city_id });
  };

  const exitPlaceMode = () => {
    setMode('browse');
    setLifted(false);
    setPlaceLabel(null);
    setNothingHere(false);
    setNearbyVenues([]);
    stopNamingPlaceCentre();
  };

  const flyTo = (place: LocalSearchResult) => {
    setSearchedPlace(place);
    // The search result carries a better name than any reverse geocode.
    setPlaceLabel(null);
    setNothingHere(false);
    // Chips from wherever the map was before the flight would be offers
    // about the wrong block. A searched place needs none (it already
    // carries a name and a category); panning away from it re-asks.
    setNearbyVenues([]);
    stopNamingPlaceCentre();
    setPlaceCoords({ lat: place.latitude, lng: place.longitude });
    // Address search is the other cross-city flight Reduce Motion turns into
    // a cut. The marker still lands on the spot, which is the information.
    // Also the app's move: the landing drop stays visual, never a thud.
    dropGate.markProgrammatic();
    mapRef.current?.animateToRegion(
      {
        latitude: place.latitude,
        longitude: place.longitude,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      },
      reduceMotion ? 0 : Motion.slow
    );
  };

  const placing = mode === 'place' || mode === 'detail';

  /**
   * A count bubble splits by zooming until its members actually separate on
   * screen. A third of the span a step where that is enough — but never a
   * fixed floor: the district-packed curated seeds sit 0.0004-0.0014 degrees
   * apart, and a floored zoom left them re-merging on every tap, an
   * unsplittable bubble. The span is computed from the widest member pair;
   * when even that cannot separate them (members on one spot), the bubble
   * opens as a venue stack instead.
   */
  const splitBubble = (screen: ScreenCluster) => {
    // The widest per-axis separation the bubble holds, in degrees. Scaled by
    // the WIDTH for both axes: for a square requested region MapKit anchors
    // the shorter screen axis, so width-scaling is what the settled camera
    // actually delivers, and it is the conservative bound either way.
    let widestDeg = 0;
    for (let i = 0; i < screen.members.length; i += 1) {
      for (let j = i + 1; j < screen.members.length; j += 1) {
        widestDeg = Math.max(
          widestDeg,
          Math.abs(screen.members[i].lat - screen.members[j].lat),
          Math.abs(screen.members[i].lng - screen.members[j].lng)
        );
      }
    }
    const splitting = (widestDeg * screenWidth) / SPLIT_CLEAR_PT;
    if (!(splitting > 0) || !Number.isFinite(splitting)) {
      setSelectedPinId(null);
      setSelectedPlaceId(null);
      setVenueKey(screen.key);
      nudgeAbove(screen.lat, screen.lng);
      return;
    }
    const stepped = (lastRegion.current?.latitudeDelta ?? 0.09) / 3;
    const delta = Math.min(stepped, splitting);
    mapRef.current?.animateToRegion(
      {
        latitude: screen.lat,
        longitude: screen.lng,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      reduceMotion ? 0 : 350
    );
  };

  /**
   * The list-originated reveal: rows are sorted by distance, not visibility,
   * so a tapped row's target can be far off screen in any direction — north
   * of centre included, exactly where nudgeAbove refuses to move. Fly there
   * when the target is outside the settled region; on-screen targets keep
   * the gentle nudge.
   */
  const revealFromList = (lat: number, lng: number) => {
    const region = lastRegion.current;
    if (region && !anyInRegion([{ lat, lng }], region)) {
      mapRef.current?.animateToRegion(
        {
          latitude: lat - region.latitudeDelta * 0.12,
          longitude: lng,
          latitudeDelta: region.latitudeDelta,
          longitudeDelta: region.longitudeDelta,
        },
        reduceMotion ? 0 : 350
      );
      return;
    }
    nudgeAbove(lat, lng);
  };

  /** The pin-select path: one selection model for markers and list rows. */
  const selectPin = (pin: CityPinRow, from?: string) => {
    if (placing || pin.id === selectedPinId) {
      return;
    }
    haptics.light();
    setVenueKey(null);
    setSelectedPlaceId(null);
    setSelectedPinId(pin.id);
    // A tapped marker is on screen by definition; a list row's pin may not be.
    if (from === 'list') {
      revealFromList(pin.lat, pin.lng);
    } else {
      nudgeAbove(pin.lat, pin.lng);
    }
    analytics.capture('pin_tapped', {
      seeded: pin.seeded,
      category: pin.category,
      ...(from ? { from } : {}),
    });
  };

  // The bottom of this screen is ONE card, not three floating slabs. The plan
  // list's sheet runs to the screen's bottom edge and the dock stands on a
  // plate cut from the same surface; this is that plate's height — the tab
  // bar clearance, the dock's MEASURED height (it grows with Dynamic Type,
  // and the constant left the card over the button's top edge at the AX
  // sizes) and the step that used to be a strip of bare map between the
  // button and the slab above it. A traveler always has the Drop-a-pin dock;
  // a business has one only once its listing is live ("Post what's on"), and
  // until then the card stands on the tab bar clearance itself.
  // (planListShown / planListCollapsed live up beside mapCovered: the slot
  // and the heatmap-view gate read the expanded list as cover.)
  const dockShown = !isBusiness || businessDockShown;
  const dockFooting = dockFootingOf({ dockBottom, dockHeight, dockShown, gap: Space.sm });
  // The one strip of map that carries a message, one gap above the card's
  // real top edge. TWO measured heights and no constant: either one composed
  // from its constant puts the chip behind the card at the AX sizes.
  const messageSlot = messageSlotOf({
    footing: dockFooting,
    peekHeight: planPeekHeight,
    planListShown,
    gap: Space.sm,
  });

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
              // Dragging the map is the instruction the search field gives
              // when nothing matched ("try the street, or drag the map to
              // the spot"), and the keyboard used to stay up through the
              // whole drag. Dismissed ONCE, on the transition into lifted:
              // this callback fires per FRAME of a pan, and a per-frame
              // dismiss ran for the drag's whole duration on the one screen
              // that must hold 60fps (see place-mode.ts).
              if (shouldDismissOnPan(lifted)) {
                Keyboard.dismiss();
              }
              setLifted(true);
            }
          }}
          onRegionChangeComplete={(region) => {
            lastRegion.current = region;
            // Only flips at the threshold, so this is not a per-frame render.
            setCityScale(region.latitudeDelta > CITY_ZOOM_DELTA);
            setSettledRegion((prev) =>
              prev &&
              metersBetween(prev.latitude, prev.longitude, region.latitude, region.longitude) <
                100 &&
              Math.abs(prev.latitudeDelta - region.latitudeDelta) / prev.latitudeDelta < 0.15
                ? prev
                : region
            );
            if (mode === 'place') {
              setLifted(false);
              setPlaceCoords({ lat: region.latitude, lng: region.longitude });
              // Drag away from the place you searched for and it stops being
              // that place. Without this the form would fill itself in with
              // the address of a venue the pin is no longer on. The fly-to
              // animation lands within metres of the target, so it survives.
              const stillSearched =
                searchedPlace != null &&
                metersBetween(
                  searchedPlace.latitude,
                  searchedPlace.longitude,
                  region.latitude,
                  region.longitude
                ) <= PLACE_DRIFT_M;
              if (!stillSearched) {
                setSearchedPlace(null);
                // Name the settled centre for the pill, debounced past the
                // rate-limit floor so a fast series of settles becomes one
                // call for the newest centre. The search result already
                // carries a better name, so only geocode once it is gone.
                if (geocodeTimer.current) {
                  clearTimeout(geocodeTimer.current);
                }
                const wait = Math.max(
                  0,
                  GEOCODE_FLOOR_MS - (new Date().getTime() - lastGeocodeAt.current)
                );
                geocodeTimer.current = setTimeout(
                  () => namePlaceCentre(region.latitude, region.longitude),
                  wait
                );
              }
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
              boundary. See features/pins/heat.ts for both. Gated on the
              client-side Busy-areas toggle; the k-threshold stays entirely
              the server's. */}
          {/* The remembered layer, drawn FIRST so every live ring composites
              over it, and at one flat low alpha rather than three stacked
              rings so it reads as ground rather than as today. The alpha
              ramp belongs beside heatFill in features/pins/heat.ts; it is
              here because that file is not this package's. */}
          {drawnHistoryCells.map((cell) => (
            <Circle
              key={`history:${cell.key}`}
              center={{ latitude: cell.lat, longitude: cell.lng }}
              radius={HEAT_CELL_RADIUS_M}
              strokeColor="transparent"
              fillColor={heatFill(cell.count, historyAlpha(cell.count))}
            />
          ))}
          {drawnHeatCells.map((cell) =>
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
                // The same city-wide flight the chip triggers, so the same
                // Reduce Motion gate.
                mapRef.current?.animateToRegion(
                  {
                    latitude: activeCity.cities.lat,
                    longitude: activeCity.cities.lng,
                    latitudeDelta: 0.09,
                    longitudeDelta: 0.09,
                  },
                  reduceMotion ? 0 : 350
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
                  own={place.id === ownBusinessId}
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
                    // The same clear-the-card nudge the pin path makes, so
                    // all three cards behave alike.
                    nudgeAbove(place.lat, place.lng);
                  }}
                />
              ))
            : null}

          {/* Bubbles first: venue clusters the current zoom draws under one
              fingertip, merged into a count that splits on tap. */}
          {!cityScale &&
            screenClusters
              .filter((screen) => screen.members.length > 1)
              .map((screen) => (
                <CountBubbleMarker
                  key={screen.key}
                  screen={screen}
                  clock={cityClock}
                  onPress={() => {
                    if (placing) {
                      return;
                    }
                    haptics.light();
                    splitBubble(screen);
                  }}
                />
              ))}

          {!cityScale &&
            screenClusters
              .filter((screen) => screen.members.length === 1)
              .map(({ members: [cluster] }) =>
                cluster.pins.length > 1 ? (
                  <ClusterMarker
                    key={cluster.key}
                    cluster={cluster}
                    selected={cluster.key === venueKey}
                    clock={cityClock}
                    onPress={() => {
                      if (placing || cluster.key === venueKey) {
                        return;
                      }
                      haptics.light();
                      setSelectedPinId(null);
                      setSelectedPlaceId(null);
                      setVenueKey(cluster.key);
                      nudgeAbove(cluster.lat, cluster.lng);
                    }}
                  />
                ) : (
                  <CityPinMarker
                    key={cluster.pins[0].id}
                    pin={cluster.pins[0]}
                    selected={cluster.pins[0].id === selectedPinId}
                    clock={cityClock}
                    // Guard doubles inside selectPin: marker onPress can fire
                    // twice on iOS. The camera nudge lives there too.
                    onPress={() => selectPin(cluster.pins[0])}
                  />
                )
              )}
        </MapView>
      ) : (
        <ThemedView style={StyleSheet.absoluteFill}>
          {featuredQuery.isError ? (
            // The hero screen used to answer a FAILED query with a dev phase
            // badge reading "no launch cities yet" — an internal note shown
            // to somebody in an airport with bad wifi.
            <LoadError
              what="the map"
              error={featuredQuery.error}
              onRetry={() => featuredQuery.refetch()}
            />
          ) : featuredQuery.isSuccess ? (
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
      {placing ? <PlacePinOverlay lifted={lifted} onDrop={dropGate.dropped} /> : null}

      {/* Dev builds only (the build-stamp precedent): how many heat rows the
          server returned for the active city and day. The COUNT only — a
          per-cell population below heat_k must never print anywhere. */}
      {__DEV__ ? (
        <ThemedText
          type="caption"
          themeColor="textSecondary"
          style={[styles.devHeatCount, { top: insets.top + Space.xs }]}>
          heat cells: {heatQuery.data?.length ?? 0}
        </ThemedText>
      ) : null}

      {/* No entering animation on the browse chrome: on the new architecture
          an ancestor mid-entering can hit-test against a stale rect, and
          "first tap after landing on the map" is exactly the moment users
          reach for these controls. */}
      {mode === 'browse' ? (
        <View style={[styles.cityBar, { top: insets.top + Spacing.two }]} pointerEvents="box-none">
          {/* No city rail for a business. It operates in exactly one city —
              seeded above from its own listing — and four chips including two
              continents away turned a fact into a navigation task. */}
          {isBusiness ? null : (
            <View style={styles.headerRow} pointerEvents="box-none">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.cityChips}
                style={styles.cityScroll}>
                {railCities.map((city) => {
                  const selected = city.city_id === activeCityId;
                  // Null below that city's own k, and null is a real answer:
                  // the chip says nothing rather than "1". Never a badge —
                  // a badge turns the chip into a card and the rail into two
                  // rows on a 375pt screen.
                  const count = city.pin_count;
                  return (
                    <PressableScale
                      key={city.city_id}
                      accessibilityRole="button"
                      accessibilityLabel={
                        count != null
                          ? `${city.cities.name}, ${countOf(count, 'plan')}`
                          : city.cities.name
                      }
                      accessibilityState={{ selected }}
                      hitSlop={4}
                      haptic="selection"
                      scaleTo={0.94}
                      onPress={() => selectCity(city)}>
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
                          style={
                            selected ? { color: theme.onAccent, fontWeight: '700' } : undefined
                          }>
                          {city.cities.name}
                        </ThemedText>
                        {/* Caption-size in both states, so the count never
                          changes the chip's height and the rail never
                          reflows — the same lesson as the line above. The
                          COLOUR follows the chip, because textSecondary on
                          the accent fill is the one pairing in this palette
                          that does not carry. */}
                        {count != null ? (
                          <ThemedText
                            type="caption"
                            style={{ color: selected ? theme.onAccent : theme.textSecondary }}>
                            {count}
                          </ThemedText>
                        ) : null}
                      </View>
                    </PressableScale>
                  );
                })}
                {/* THE SEARCH CHIP. The rail is where the plans are, not the
                    only places a person may go: any city in the reference
                    table can be browsed, and the one they pick joins the
                    rail in front. Outlined rather than filled so it reads as
                    a different kind of thing from the cities, and last so it
                    never sits between two of them. */}
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Search for a city"
                  hitSlop={4}
                  haptic="selection"
                  scaleTo={0.94}
                  onPress={() => {
                    // The same clears the filter button makes: three sheets
                    // at the bottom of one map is a pile.
                    setSelectedPinId(null);
                    setSelectedPlaceId(null);
                    setVenueKey(null);
                    setCityQuery('');
                    setCitySearchOpen(true);
                  }}>
                  <View
                    style={[
                      styles.cityChip,
                      { backgroundColor: theme.surface, borderColor: theme.border },
                    ]}>
                    <SymbolView
                      name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                      size={13}
                      tintColor={theme.textSecondary}
                    />
                    <ThemedText type="small" themeColor="textSecondary">
                      Anywhere
                    </ThemedText>
                  </View>
                </PressableScale>
              </ScrollView>
            </View>
          )}
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
                  case is one chip and the avatar.

                  Never for a business. It is a shortcut to /visibility, which
                  is a traveler-discovery setting the database now refuses a
                  business outright (set_visibility, 20260829190000) and which
                  the router does not mount for them - so the one thing the
                  chip does would have been a tap that goes nowhere. */}
              {isBusiness ? null : <AudienceChip audience={audience} />}
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
      {slot === 'pins-error' ? (
        <View style={[styles.emptyBanner, { bottom: messageSlot }]}>
          <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
            <LoadError
              what="the pins"
              error={pinsQuery.error}
              onRetry={() => pinsQuery.refetch()}
            />
          </GlassSurface>
        </View>
      ) : null}

      {/* The heat ask failed on its own: without this, a dead heat layer and
          a genuinely quiet city rendered identically. Same glass banner, the
          compact LoadError form; the pins error outranks it in the slot —
          two stacked failure cards is a pile-up, and pins are the map. */}
      {slot === 'heat-error' ? (
        <View style={[styles.emptyBanner, { bottom: messageSlot }]}>
          <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
            <LoadError
              compact
              what="the busy areas"
              error={heatQuery.error}
              onRetry={() => heatQuery.refetch()}
            />
          </GlassSurface>
        </View>
      ) : null}

      {/* An owner's own chip is missing from their own map, and the state
          says why. Only 'unconfirmed' is a tap — the email code is the one
          absence the owner can fix themselves; the other states have nothing
          here for them to do. The 'Tap a business' legend is silenced while
          this is up by the slot itself, or the screen says two things at
          once. */}
      {slot === 'own-listing' && ownListingNotice ? (
        ownListingNotice.pressable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${ownListingNotice.line} ${ownListingNotice.detail}`}
            onPress={() => router.push('/business-email')}
            style={[styles.emptyBanner, { bottom: messageSlot }]}>
            <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
              <ThemedText type="smallBold">{ownListingNotice.line}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {ownListingNotice.detail}
              </ThemedText>
            </GlassSurface>
          </Pressable>
        ) : (
          <View style={[styles.emptyBanner, { bottom: messageSlot }]} pointerEvents="none">
            <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
              <ThemedText type="smallBold">{ownListingNotice.line}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {ownListingNotice.detail}
              </ThemedText>
            </GlassSurface>
          </View>
        )
      ) : null}

      {slot === 'empty-city' && activeCity && !isBusiness ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Be the first to drop a pin"
          onPress={() => enterPlaceMode()}
          style={[styles.emptyBanner, { bottom: messageSlot }]}>
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

      {/* The same fact for an owner, with the invitation taken out. A business
          cannot drop a pin, so the traveler card above is hidden from them -
          and hiding it left an empty city with nothing at all on it, which
          reads as a map that failed to load rather than as a quiet Tuesday.
          Not pressable, because there is nothing here for them to do. */}
      {/* The chips-answering-the-filters suppression lives in the emptyCity
          flag the slot reads, beside its siblings. */}
      {slot === 'empty-city' && activeCity && isBusiness ? (
        <View style={[styles.emptyBanner, { bottom: messageSlot }]} pointerEvents="none">
          <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
            <ThemedText type="smallBold">
              {isDefault(filters)
                ? `Nothing pinned in ${activeCity.cities.name} yet`
                : 'Nothing matches your filters'}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {isDefault(filters)
                ? 'Plans travelers make here show up on this map.'
                : // Not "what is on": that is this owner's own word for their
                  // posts, on their own tab, and it does not mean this.
                  'Widen them to see traveler plans.'}
            </ThemedText>
          </GlassSurface>
        </View>
      ) : null}

      {/* Panned a little away: the plans exist, they are just not in the
          frame. Says so instead of impersonating an empty city. */}
      {slot === 'viewport-empty' && activeCity ? (
        <View style={[styles.emptyBanner, { bottom: messageSlot }]} pointerEvents="none">
          <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
            <ThemedText type="smallBold">No plans over here.</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {`${activeCity.cities.name}'s are back that way.`}
            </ThemedText>
          </GlassSurface>
        </View>
      ) : null}

      {/* Panned properly away: a discoverable way home. Tapping the selected
          city chip also recentres, but nobody guesses a selected chip is a
          button. Lands where the app framed the city's plans, which is
          where the lit chip's tap lands and where "away" is measured from. */}
      {slot === 'way-home' && activeCity ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.legend, { bottom: messageSlot }]}
          pointerEvents="box-none">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Back to ${activeCity.cities.name}`}
            haptic="light"
            scaleTo={0.94}
            onPress={goHome}>
            <View
              style={[
                styles.legendChip,
                { backgroundColor: theme.surface, borderColor: theme.hairline },
              ]}>
              <SymbolView
                name={{
                  ios: 'arrow.uturn.backward',
                  android: 'undo',
                  web: 'undo',
                }}
                size={13}
                tintColor={theme.accent}
              />
              <ThemedText type="footnote">Back to {activeCity.cities.name}</ThemedText>
            </View>
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* The reward for finishing thirteen signup screens used to be a frame
          identical to the one the guest already saw. Once, in the session
          that finished onboarding, until the first pin. */}
      {slot === 'first-session' ? (
        <View style={[styles.emptyBanner, { bottom: messageSlot }]} pointerEvents="none">
          <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
            <ThemedText type="smallBold">
              {ownProfile?.display_name
                ? `You're on the map, ${ownProfile.display_name}.`
                : "You're on the map."}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {"Pin where you're headed and people can join."}
            </ThemedText>
          </GlassSurface>
        </View>
      ) : null}

      {/* The follow-up for the one person who accepted "Be the first" — on
          the empty banner's own footprint. The promise is scoped to the
          pin's ≤72h life, and the ask goes through the push primer, which
          owns the only safe way to present a sheet on this screen (it waits
          on the tabs, the modal count, and the settle delay). */}
      {slot === 'first-pin' && activeCity ? (
        <View style={[styles.emptyBanner, { bottom: messageSlot }]}>
          <GlassSurface radius={Radius.lg} style={styles.emptyCard}>
            <ThemedText type="smallBold">{`You're first in ${activeCity.cities.name}.`}</ThemedText>
            {/* The promise matches what the pin can receive: a message-first
                pin (no chat) cannot be joined, and this banner must not say
                it can. */}
            <ThemedText type="footnote" themeColor="textSecondary">
              {ownOnlyPin?.chat_id != null
                ? "We'll tell you if someone joins while your pin is up."
                : "We'll tell you if someone messages you while your pin is up."}
            </ThemedText>
            {/* Only while the primer can actually present. useCreatePin
                already asked on post, so for exactly the person this banner
                targets the ask is usually spent — and a tap the store would
                silently swallow is worse than no action. The text stands
                either way. */}
            {firstPinAsked || !firstPinAskable ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Turn on notifications"
                hitSlop={8}
                onPress={() => {
                  setFirstPinAsked(true);
                  void askPrimer('pin-posted');
                }}>
                <ThemedText type="footnote" themeColor="accent">
                  Turn on notifications
                </ThemedText>
              </Pressable>
            )}
          </GlassSurface>
        </View>
      ) : null}

      {mode === 'place' ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.dock, { bottom: dockBottom }]}
          pointerEvents="box-none">
          {/* The venues under the pin, when MapKit has any: tap one and the
              pin lands on it, carrying its name and category into the form
              exactly the way a searched place does. Absent rather than
              empty when there is nothing to offer (open water, sparse
              regions, a binary without nearbyAsync) — the name pill below
              remains the fallback. */}
          {nearbyVenues.length > 0 ? (
            // A scroller, not a row. Three venue names in a centred flex row
            // overflowed the dock and were clipped at BOTH screen edges -
            // "astry Central World" on the left, "Dum Han" on the right, in
            // the founder's 2026-09-04 screenshot - because a chip could
            // shrink but the text inside it could not. Horizontal scrolling
            // is what Apple Maps does with its own chip row; the content
            // centres itself while it fits and starts at the gutter once it
            // does not, so nothing is ever cut off and nothing looks
            // clipped when it is not.
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              style={styles.nearbyScroller}
              contentContainerStyle={styles.nearbyRow}>
              {nearbyVenues.map((venue, index) => {
                const active = searchedPlace === venue;
                return (
                  <PressableScale
                    key={`${venue.name}:${venue.latitude}:${venue.longitude}`}
                    testID={`nearby-venue-${index}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    // A hint, not a label: the label would hide the venue's
                    // name from anything reading the printed text (see
                    // traps), and the name IS the information.
                    accessibilityHint="Puts the pin on it"
                    scaleTo={0.96}
                    haptic="light"
                    // The chip is 34pt tall; the slop makes the target 44.
                    hitSlop={5}
                    onPress={() => {
                      setSearchedPlace(venue);
                      setPlaceLabel(null);
                      setNothingHere(false);
                      setPlaceCoords({ lat: venue.latitude, lng: venue.longitude });
                      // Kill the debounced geocode: the venue's own name now
                      // leads, and a late reverse geocode must not re-ask
                      // about a centre the pin has already left.
                      stopNamingPlaceCentre();
                      // The app's own camera move, so the landing must not
                      // thud like a choice. At the CURRENT zoom, not flyTo's:
                      // the venue is a few metres away and a zoom change
                      // would read as leaving the block.
                      dropGate.markProgrammatic();
                      const region = lastRegion.current;
                      mapRef.current?.animateToRegion(
                        {
                          latitude: venue.latitude,
                          longitude: venue.longitude,
                          latitudeDelta: region?.latitudeDelta ?? 0.012,
                          longitudeDelta: region?.longitudeDelta ?? 0.012,
                        },
                        Motion.standard
                      );
                    }}
                    style={[
                      styles.nearbyChip,
                      Elevation.floating,
                      { backgroundColor: active ? theme.accent : theme.surface },
                    ]}>
                    <ThemedText
                      type="footnote"
                      numberOfLines={1}
                      style={active ? { color: theme.onAccent } : undefined}>
                      {venue.name}
                    </ThemedText>
                  </PressableScale>
                );
              })}
            </ScrollView>
          ) : null}
          {/* The spot's name, BEFORE the commitment: the reverse geocode the
              form used to run one screen too late now feeds this card. Kept
              mounted and only dimmed while the map is moving: a card that
              appears and vanishes on every drag is worse motion than one
              that goes quiet.

              A CARD, NOT A FOURTH CHIP. It was a pill in the same surface,
              the same footnote and the same shadow as the venue chips above
              it, one line, ellipsised in the middle of the district - and
              the founder read it as one more option rather than the answer.
              The chips are choices; this is where the pin is. So it carries
              the pin's own glyph in the pin's own colour, the place on a
              line of its own with room for two, the district or street under
              it in the secondary voice, the sunken surface with a hairline
              instead of the chips' raised surface, and a card's corner
              rather than a pill's. Not glass, which is a finish and never
              the thing carrying contrast. */}
          {(() => {
            const spot =
              nothingHere && !searchedPlace
                ? { primary: 'Nothing here. Drag to a street or a venue.', secondary: null }
                : searchedPlace
                  ? {
                      primary: searchedPlace.name,
                      secondary: searchedPlace.address ?? searchedPlace.locality,
                    }
                  : placeLabel
                    ? splitSpotLabel(placeLabel)
                    : { primary: 'Drop it here', secondary: null };
            return (
              <View
                accessible
                accessibilityLabel={
                  spot.secondary ? `${spot.primary}, ${spot.secondary}` : spot.primary
                }
                style={[
                  styles.spotCard,
                  Elevation.floating,
                  { backgroundColor: theme.surfaceSunken, borderColor: theme.hairline },
                ]}>
                <SymbolView
                  name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }}
                  size={18}
                  tintColor={lifted ? theme.textSecondary : theme.highlight}
                />
                <View style={styles.spotText}>
                  <ThemedText
                    type="smallBold"
                    numberOfLines={2}
                    themeColor={lifted ? 'textSecondary' : undefined}>
                    {spot.primary}
                  </ThemedText>
                  {spot.secondary ? (
                    <ThemedText type="caption" numberOfLines={1} themeColor="textSecondary">
                      {spot.secondary}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            );
          })()}
          <View style={styles.confirmBar}>
            <PrimaryButton
              label="Pin here"
              disabled={placeCoords == null || lifted || (nothingHere && !searchedPlace)}
              onPress={() => {
                haptics.light();
                // Kill the debounced geocode: a timer armed by the last pan
                // settling could otherwise fire into the OPEN form, change
                // its initialLabel prop, cancel its own fallback fetch and
                // reseed its label mid-edit.
                stopNamingPlaceCentre();
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
          cityTimezone={activeCity.timezone}
          coords={placeCoords}
          initialPlace={searchedPlace}
          initialLabel={placeLabel}
          onClose={() => setMode('place')}
          onPosted={(pinId, city) => {
            setMode('browse');
            setLifted(false);
            setPlaceLabel(null);
            stopNamingPlaceCentre();
            // The pin may have landed in another city: dropped in Manhattan
            // while the Bangkok chip was lit, it belongs to New York, and
            // the map goes where the pin went rather than showing a
            // confirmation card for a plan it is not drawing.
            if (city && city.id !== activeCity.city_id) {
              applyCity(browseCityFromCityRow(city));
            }
            // The form lets you pin for tomorrow — at a beach, unverified —
            // while the map is filtered to today's bars, and both the markers
            // and the confirmation card read from the FILTERED list, so the
            // sheet closed on a map that looked untouched and said nothing
            // had been pinned. Clearing every filter is the only setting
            // guaranteed to contain whatever was just posted.
            setFilters(DEFAULT_FILTERS);
            // And re-arm the camera fit, so the fresh pin is framed with its
            // neighbours when the refetched rows land — the filters may
            // already have been at their default, which alone would not.
            lastFitKey.current = null;
            // Sheets are presented as modals, and iOS silently drops a
            // presentation that begins while another modal is still
            // dismissing — which left a freshly dropped pin with no
            // confirmation card at all. Wait for the form to finish leaving,
            // then select it (the card also needs the refetched row).
            setTimeout(() => setSelectedPinId(pinId), SHEET_SETTLE_MS);
          }}
        />
      ) : null}

      {/* What is on in this city, as a list under the map (founder decision
          D4: the map's own bottom sheet, never a directory tab). Rows carry
          no names and no faces for ANY viewer — a guest's and a business's
          pin feed is identity-stripped server-side, and one row shape for
          everyone is the simplest thing to keep honest. */}
      {activeCity && mode === 'browse' ? (
        <PlanList
          cityName={activeCity.cities.name}
          pins={pins}
          clusters={clusters}
          clock={cityClock}
          places={places}
          isBusinessViewer={isBusiness}
          ownBusinessId={ownBusinessId}
          centre={mapCentre}
          collapsed={planListCollapsed}
          detent={planDetent}
          onDetentChange={setPlanDetent}
          footing={dockFooting}
          peekHeight={planPeekHeight}
          onPeekHeight={setPlanPeekHeight}
          onSelectPin={(pin) => selectPin(pin, 'list')}
          onSelectVenue={(key) => {
            haptics.light();
            setSelectedPinId(null);
            setSelectedPlaceId(null);
            setVenueKey(key);
            // Same list-originated rule as a row's pin: the venue can be far
            // off screen, and the stack sheet about a marker nobody can see
            // reads as the wrong sheet.
            const venue = clusters.find((cluster) => cluster.key === key);
            if (venue) {
              revealFromList(venue.lat, venue.lng);
            }
          }}
          onSelectBusiness={(id) => {
            haptics.light();
            setSelectedPinId(null);
            setVenueKey(null);
            setSelectedPlaceId(id);
          }}
        />
      ) : null}

      {/* The card's base, and the only reason it exists: at the half and full
          detents the list's frame reaches the screen edge, so its rows scroll
          through the bottom `dockFooting` points. This is the opaque ground
          between them and the button. At the peek it is invisible — the
          sheet's own surface already covers this band — and that is the
          point: one colour token, no seam. Gated on the LIST, not on a dock
          existing: an owner whose listing is not live yet has no button and
          still has a list, and without the plate its first rows would render
          sliced by the floating tab bar, which is the defect this whole
          change is about. Inert to touch, like the docked action bar's plate:
          the sheet under it already absorbs the tap, and the buttons below
          are later siblings, so they still hit-test first. No entrance (the
          browse chrome has none) and no shadow (the sheet above carries the
          card's only lift). */}
      {planListShown ? (
        <View
          pointerEvents="none"
          style={[styles.dockPlate, { height: dockFooting, backgroundColor: theme.surface }]}
        />
      ) : null}

      {activeCity && mode === 'browse' && !isBusiness && !selectedPin ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.dock, { bottom: dockBottom }]}
          pointerEvents="box-none">
          {/* Blue, not amber. Amber now belongs to the pins themselves, and
              two warm things on one screen means neither reads as the
              signal. Controls are the brand blue; the map's content is warm. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Drop a pin"
            scaleTo={0.95}
            haptic="light"
            onPress={() => enterPlaceMode()}
            // The measured height feeds `dockFooting` — the plate this
            // button stands on, and the base of the card above it. The
            // minHeight grows with Dynamic Type, and a plate built on the
            // constant is one the button's top edge hangs over.
            onLayout={(event) =>
              setDockHeight(Math.max(DOCK_MIN_HEIGHT, Math.round(event.nativeEvent.layout.height)))
            }
            style={[styles.dockButton, { backgroundColor: theme.accent }]}>
            <SymbolView
              name={{ ios: 'mappin.and.ellipse', android: 'add_location', web: 'add_location' }}
              size={19}
              tintColor={theme.onAccent}
            />
            <ThemedText type="callout" style={[styles.dockLabel, { color: theme.onAccent }]}>
              Drop a pin
            </ThemedText>
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* The business dock: the one action a listed owner has on this map.
          Says what is on tonight, or updates it — NEVER 'Drop a pin', and
          never through enterPlaceMode, which returns early for a business
          (the founder's rule at features/business/hooks and the
          assert_not_business trigger both forbid a business pin). Gated on
          'listed': posting into a listing nobody can see helps nobody, so
          until then the own-listing card carries the strip instead. */}
      {activeCity && mode === 'browse' && businessDockShown && !selectedPin ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.dock, { bottom: dockBottom }]}
          pointerEvents="box-none">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={ownPlace?.has_live_post ? 'Update tonight' : "Post what's on"}
            scaleTo={0.95}
            haptic="light"
            onPress={() => router.push('/business-post')}
            // The same measurement the traveler dock feeds `dockFooting`:
            // the button grows with Dynamic Type.
            onLayout={(event) =>
              setDockHeight(Math.max(DOCK_MIN_HEIGHT, Math.round(event.nativeEvent.layout.height)))
            }
            style={[styles.dockButton, { backgroundColor: theme.accent }]}>
            <SymbolView
              name={{ ios: 'storefront', android: 'storefront', web: 'storefront' }}
              size={19}
              tintColor={theme.onAccent}
            />
            <ThemedText type="callout" style={[styles.dockLabel, { color: theme.onAccent }]}>
              {ownPlace?.has_live_post ? 'Update tonight' : "Post what's on"}
            </ThemedText>
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* The day filter emptied the heat and the all-days layer is standing
          in. NEVER unlabelled, and never through the one-shot dismissible
          legend (dismissed forever after one read): this footnote is up for
          exactly as long as the fallback is drawn. */}
      {slot === 'heat-fallback' ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.legend, { bottom: messageSlot }]}
          pointerEvents="none">
          <View
            style={[
              styles.legendChip,
              { backgroundColor: theme.surface, borderColor: theme.hairline },
            ]}>
            <View style={[styles.legendDot, { backgroundColor: 'rgba(255, 154, 90, 0.85)' }]} />
            <ThemedText type="footnote">Busy areas shown across the next three days</ThemedText>
          </View>
        </Animated.View>
      ) : null}

      {/* The heat layer is the only thing on this map with no label, no
          marker and nothing to tap, so the first time somebody sees it they
          have to guess. One sentence, once. */}
      {slot === 'heat-legend' ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.legend, { bottom: messageSlot }]}
          pointerEvents="box-none">
          <PressableScale
            accessibilityRole="button"
            // Never "nearby": the map is scoped to a city chip that may be a
            // continent away, and the app never knows where anybody is.
            accessibilityLabel={heatLegendLine}
            containerStyle={styles.legendPress}
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
              <ThemedText type="footnote" style={styles.legendText}>
                {heatLegendLine}
              </ThemedText>
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={11}
                tintColor={theme.textSecondary}
              />
            </View>
          </PressableScale>
        </Animated.View>
      ) : null}

      {slot === 'places-legend' ? (
        <Animated.View
          entering={FadeInUp.duration(Motion.standard)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[styles.legend, { bottom: messageSlot }]}
          pointerEvents="box-none">
          <PressableScale
            accessibilityRole="button"
            containerStyle={styles.legendPress}
            // An owner already knows what the chips are; what they cannot see
            // is which one is theirs, so the one sentence they get teaches the
            // ring instead.
            accessibilityLabel={
              ownChipOnMap
                ? 'The ringed chip is your business.'
                : "The small chips are businesses. Tap one to see what's on."
            }
            accessibilityHint="Dismisses this"
            scaleTo={0.96}
            haptic="light"
            onPress={placesLegend.dismiss}>
            <View
              style={[
                styles.legendChip,
                { backgroundColor: theme.surface, borderColor: theme.hairline },
              ]}>
              {/* Their own category when the sentence is about their own
                  chip. It was hardcoded to a bar, so a cafe was shown a
                  ringed cocktail glass and told to go and find it. */}
              <PlaceGlyph
                category={ownChipOnMap ? (ownBusiness?.category ?? 'bar') : 'bar'}
                live={false}
                size={18}
                onSurface
                own={ownChipOnMap}
              />
              <ThemedText type="footnote">
                {ownChipOnMap
                  ? 'The ringed chip is your business'
                  : "Tap a business to see what's on"}
              </ThemedText>
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
            // The invitation leads; the name disclosure is the small print
            // under it. The headline slot was carrying a privacy warning at
            // the exact moment somebody showed enthusiasm.
            reason={gate === 'join' ? 'Join the plan and the chat' : 'Put your plan on the map'}
            detail={
              gate === 'join'
                ? undefined
                : 'Your name and photo go on the pin, so people know who they are meeting. It disappears within three days.'
            }
            where={gate === 'join' ? 'join-plan' : 'drop-pin'}
            // Flat, not a card. The Sheet around it is already the elevated
            // object, so the gate's own frame was a card inside a card at the
            // one moment we ask a browsing guest for an account.
            flat
            // Pushing a route from inside a sheet leaves its scrim over the
            // map and every later tap lands on nothing. See components/ui/sheet.
            onNavigate={(go) => {
              // Remember what they were DOING before the wall: the plan they
              // tried to join, or the spot they had panned to. Recorded only
              // on the tap through - backing out records nothing.
              if (activeCityId != null) {
                intentRemembered(
                  gate === 'join' && joinGatePinId.current != null
                    ? { kind: 'pin', cityId: activeCityId, pinId: joinGatePinId.current }
                    : { kind: 'drop-pin', cityId: activeCityId, region: lastRegion.current }
                );
              }
              leavingSheet(() => setGate(null))(go);
            }}
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
          clock={cityClock}
          // The SAME arrays the markers render, or the number contradicts
          // the dots the moment Businesses is unticked.
          resultCount={mapResultCount(pins.length, places.length, filters)}
          totalCount={allPins.length + places.length}
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
              {/* Only when the headline is a NAME. clusterTitle's last
                  fallback is this same count, and the sheet used to print
                  it twice, as its own title and subtitle. */}
              {clusterTitle(openVenue) !== `${countOf(openVenue.pins.length, 'plan')} here` ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {countOf(openVenue.pins.length, 'plan')} here
                </ThemedText>
              ) : null}
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
            {/* Earliest first, and the plans that named no hour after the
                ones that did. The server orders both feeds this way; the
                clusterer regroups them by venue and this puts the stack back
                in the order somebody reads it in. */}
            {[...openVenue.pins].sort(byIntentMoment).map((pin) => (
              <PressableScale
                key={pin.id}
                accessibilityRole="button"
                accessibilityLabel={`${pin.venue_name}, ${pin.display_name ?? 'a traveler'}`}
                scaleTo={0.98}
                // Inside the venue stack's ScrollView, which is capped at 260
                // and genuinely scrolls - a touch-down haptic would buzz on
                // every flick past a row.
                haptic="none"
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
                    {/* The same decider as the hero this row opens, so a row
                        and its card agree on the pin's name. */}
                    <ThemedText type="callout" numberOfLines={1}>
                      {pinSubtitle(pin) ?? pinTitle(pin)}
                    </ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                      {[pin.display_name, whenLabel(pin, cityClock)].filter(Boolean).join(' · ')}
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
              // Same card-in-card as the gate sheet above: the pin card is a
              // `<Sheet inline>`, which draws the same surface, so the gate's
              // frame bought a second edge and nothing else.
              flat
              onNavigate={(go) => {
                // The pin they were reading, replayed after signup - and
                // degraded silently to the city if it burns out first.
                if (activeCityId != null) {
                  intentRemembered({
                    kind: 'pin',
                    cityId: activeCityId,
                    pinId: selectedPin.id,
                  });
                }
                leavingSheet(() => setSelectedPinId(null))(go);
              }}
            />
          ) : (
            <PinCard
              pin={selectedPin}
              cityId={activeCityId}
              clock={cityClock}
              onClose={() => setSelectedPinId(null)}
              onOpenBusiness={(businessId) => {
                // A straight swap, not a presentation: both cards are
                // `Sheet inline`, so there is no <Modal> being dismissed for
                // iOS to race against and no settle delay to wait out.
                setSelectedPinId(null);
                setSelectedPlaceId(businessId);
              }}
              onNeedsAccount={() => {
                // By the time the join gate's navigate runs the card is
                // closed, so the plan's id is parked here for it.
                joinGatePinId.current = selectedPin.id;
                leavingSheet(() => setSelectedPinId(null))(() => setGate('join'));
              }}
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

      {/* ANYWHERE. Any of the ~49,000 cities in the reference table; the
          plans and travelers in it are drawn the moment somebody adds one,
          and nobody has to ask for a city to be opened.

          A real Sheet rather than an inline one, because this is a form and
          it wants the keyboard handling: `avoidKeyboard` grows the floor
          instead of lifting the sheet. Opened only from a tap, never from a
          data event, so it is not the presentation iOS drops (see the traps
          skill). */}
      {mode === 'browse' && citySearchOpen ? (
        <Sheet
          onClose={() => {
            setCitySearchOpen(false);
            setCityQuery('');
          }}
          avoidKeyboard>
          <ThemedText type="headline">Anywhere</ThemedText>
          <ThemedText type="body" themeColor="textSecondary">
            Any city. Plans and travelers there show up the moment somebody adds one.
          </ThemedText>
          <FormTextField
            label="City"
            testID="city-search-input"
            placeholder="Start typing: Nice, Manhattan, Chiang Mai"
            value={cityQuery}
            onChangeText={setCityQuery}
            autoFocus
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="search"
          />
          {(citySearch.data ?? []).map((row) => {
            // Five US Springfields exist: show the admin region when a name
            // repeats within the result set. The same rule add-trip uses.
            const duplicated =
              (citySearch.data ?? []).filter(
                (other) => other.name === row.name && other.country_code === row.country_code
              ).length > 1;
            return (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={`${row.name}, ${row.country_name}`}
                style={[styles.citySuggestion, { backgroundColor: theme.backgroundElement }]}
                onPress={() => {
                  setCitySearchOpen(false);
                  setCityQuery('');
                  selectCity(browseCityFromCityRow(row));
                }}>
                <ThemedText>
                  {row.name}
                  <ThemedText themeColor="textSecondary">
                    {duplicated && row.admin ? `, ${row.admin}` : ''}, {row.country_name}
                  </ThemedText>
                </ThemedText>
              </Pressable>
            );
          })}
          {cityQuery.trim().length >= 2 && citySearch.isSuccess && citySearch.data.length === 0 ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              Nothing called that. Try the nearest town of any size.
            </ThemedText>
          ) : null}
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
  legend: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // The chip measures to its sentence, and the sentence is longer than a
    // phone is wide: run 109 photographed its dot sliced by the left edge
    // and its close by the right. Insets here and a ceiling on the press
    // below, so the text wraps instead.
    paddingHorizontal: Space.lg,
  },
  // On the OUTER Pressable (containerStyle): the strip's padded box is the
  // definite width a percentage resolves against, and the inner chip only
  // wraps once the press it sits in is bounded.
  legendPress: {
    maxWidth: '100%',
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    // A large radius rather than a pill: at the accessibility sizes the
    // sentence is five lines tall and a pill's corners swallow the first
    // and last of them.
    borderRadius: Radius.lg,
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
  // Shrinks so the empty-state sentence wraps inside the chip instead of
  // pushing its close glyph off screen.
  legendText: {
    flexShrink: 1,
  },
  devHeatCount: {
    position: 'absolute',
    left: Space.sm,
  },
  statusScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  /* One city from search_cities. The fill is the field's own, by token name
     and not by luck, so the list reads as part of the box above it. */
  citySuggestion: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  cityChip: {
    // A row now that a count rides beside the name. Centre-aligned rather
    // than baseline: two different type roles on one baseline pull the
    // smaller one down and the chip grows to fit it.
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
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
  // Card chrome, not marker artwork, so the accessibility argument cuts the
  // other way: the fallback initial scales with Dynamic Type and the disc
  // grows with it rather than freezing the text.
  crewFace: {
    borderRadius: 999,
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
  // The ground the dock stands on while the plan list is up: the same
  // theme.surface as the list's sheet, running to the screen bottom, so the
  // two are one card rather than two slabs with a strip of map between them.
  // The height is `dockFooting`, injected inline because it composes a
  // measured height. Symmetric left/right, so the RTL ratchet in
  // scripts/__tests__/logical-directional-styles.test.ts stays where it is.
  dockPlate: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  dockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    // min, not fixed: the label scales with Dynamic Type, and a frozen box
    // around scaling text is the clipping bug the audit named. The grown
    // height is measured by onLayout and feeds `dockFooting`.
    minHeight: DOCK_MIN_HEIGHT,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.xl,
    borderRadius: Radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  // Size comes from the ThemedText role; only the weight is local.
  dockLabel: {
    fontWeight: '600',
  },
  confirmBar: {
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.four,
  },
  // The scroller spans the dock; its content centres while it fits
  // (flexGrow on a horizontal scroller's content is what makes
  // justifyContent mean anything) and starts at the gutter once it does not.
  nearbyScroller: {
    alignSelf: 'stretch',
    flexGrow: 0,
    marginBottom: Space.sm,
  },
  nearbyRow: {
    flexGrow: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.lg,
    // Room for the chips' shadow, which a scroller would otherwise clip.
    paddingVertical: Space.xs,
  },
  nearbyChip: {
    // A cap rather than a shrink: inside a scroller a chip takes its own
    // width, so one very long venue name gets an ellipsis at 240pt instead
    // of pushing the row a screen wide.
    maxWidth: 240,
    minHeight: 34,
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  spotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    maxWidth: '92%',
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Space.sm,
  },
  spotText: {
    flexShrink: 1,
    gap: 1,
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
