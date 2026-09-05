import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openInAppBrowser } from '@/components/external-link';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import { PressableScale } from '@/components/ui/pressable-scale';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { Skeleton } from '@/components/ui/skeleton';
import { HitTarget, MaxContentWidth, Motion, Radius, Space } from '@/constants/theme';
import { useBusinessDetail, useOwnBusiness, useRatingSummary } from '@/features/business/hooks';
import { PlaceSeal } from '@/features/business/place-seal';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  LINK_LABEL,
  TAG_LABEL,
  cityNow,
  isOpenNow,
  openLine,
  shortTime,
  weekdayLabel,
} from '@/features/business/vocabulary';
import { hrefFor, linkCaution, opensInAppBrowser } from '@/features/business/links';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { LISTING_SHARE_LABEL, shareListing } from '@/features/business/share-listing';
import { dayLabel } from '@/features/chat/separators';
import { useIsGuest } from '@/features/guest/hooks';
import { useMyChats } from '@/features/matching/hooks';
import { browseCityFromCityRow } from '@/features/pins/api';
import { useCity } from '@/features/pins/hooks';
import { openInMaps } from '@/features/pins/open-in-maps';
import { PinFormSheet } from '@/features/pins/pin-form-sheet';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { clocks } from '@/lib/locale';
import { analytics } from '@/lib/analytics';
import type { BusinessHourJson, BusinessLinkJson, BusinessPostJson } from '@/lib/database.types';
import { countOf } from '@/lib/plural';

/** 24-hour, so an event time reads next to "Open · till 2:00" as one clock. */
// No local formatter, and the comment that used to sit here ("24-hour, so an
// event time reads next to 'Open · till 2:00' as one clock") is now exactly
// backwards: shortTime follows the PHONE since biz-one-clock, so a pinned
// hour12:false printed "20:00" for the event beside "till 8:00 PM" for the
// hours, on the same card. One clock means one source, not one format.

/**
 * ONE ratio for every business photo a traveler sees.
 *
 * The hero was 3:2, the post photo 16:9 and the gallery strip 4:3, so a
 * single uploaded square was cropped three different ways on one screen and
 * an owner could not frame anything. The editor now draws a 3:2 trim guide
 * over each tile (business-photos.tsx), and that guide is only honest if
 * every surface it predicts actually uses this number. place-sheet.tsx is
 * already 3:2.
 */
const HERO_RATIO = 3 / 2;

function PlaceImage({
  path,
  style,
  fallback,
  label,
}: {
  path: string | null;
  style?: StyleProp<ViewStyle>;
  fallback?: ReactNode;
  /** What the photo is of. A "Photos" heading over unlabelled images is a
      heading over nothing, as far as VoiceOver is concerned. */
  label?: string;
}) {
  const theme = useTheme();
  const { data: url } = useBusinessPhotoUrl(path);
  return (
    <View style={[styles.frame, { backgroundColor: theme.surfaceSunken }, style]}>
      {url ? (
        <Image
          source={{ uri: url }}
          style={styles.fill}
          contentFit="cover"
          transition={Motion.quick}
          accessibilityLabel={label}
        />
      ) : (
        fallback
      )}
    </View>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: SymbolViewProps['name'];
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <SymbolView name={icon} size={15} tintColor={theme.textSecondary} />
        <ThemedText type="caption" themeColor="textSecondary">
          {title}
        </ThemedText>
      </View>
      {children}
    </View>
  );
}

function PostCard({ post }: { post: BusinessPostJson }) {
  const theme = useTheme();
  const when = post.happens_at;
  const at = when ? new Date(when) : null;
  const today = at != null && at.toDateString() === new Date().toDateString();

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      {post.photo_path ? (
        <PlaceImage path={post.photo_path} style={styles.postPhoto} label={post.title} />
      ) : null}
      <View style={styles.cardBody}>
        {at && when ? (
          // Warm light is this app's "happening now", the same signal the map
          // puts on a place with something on tonight.
          <ThemedText type="caption" themeColor={today ? 'highlight' : 'textSecondary'}>
            {`${dayLabel(when)} · ${clocks().instant.format(at)}`}
          </ThemedText>
        ) : null}
        <ThemedText type="callout">{post.title}</ThemedText>
        {post.body ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {post.body}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

/** Every range a day has, or the fact that it has none. */
function dayRanges(hours: BusinessHourJson[], weekday: number): string {
  const rows = hours.filter((h) => h.weekday === weekday);
  if (rows.length === 0) {
    return 'Closed';
  }
  // "20:00 to 2:00" is one night, which is what most bars actually do.
  return rows.map((h) => `${shortTime(h.opens)} to ${shortTime(h.closes)}`).join(', ');
}

function Hours({
  hours,
  note,
  name,
  onMessage,
}: {
  hours: BusinessHourJson[];
  note: string | null;
  /** Whose door it is, for the spoken label on the button below. */
  name: string;
  /**
   * The one move left when nobody has said when the door is open, or null when
   * this reader has no such move: a guest, a business account, or the owner
   * looking at their own listing. See the ask-them branch below.
   */
  onMessage: (() => void) | null;
}) {
  const theme = useTheme();
  const [openWeek, setOpenWeek] = useState(false);
  // Starting at today rather than at Monday: the row somebody came for is the
  // one they are standing in, and every map app they already use does this.
  const today = new Date().getDay();
  const week = Array.from({ length: 7 }, (_, offset) => (today + offset) % 7);
  const shown = openWeek ? week : week.slice(0, 1);
  // Signup is right not to make an owner guess their hours, and step 9 is
  // skippable. The consequence was on the traveler's side: no open line in the
  // meta row and no Hours section at all, so "should I go there tonight" was
  // neither answered nor acknowledged, and an absent section is
  // indistinguishable from one that failed to load.
  const unknown = hours.length === 0 && !note;

  return (
    <Section title="Hours" icon={{ ios: 'clock', android: 'schedule', web: 'schedule' }}>
      {unknown ? (
        <>
          <ThemedText type="footnote" themeColor="textSecondary">
            Hours not set
          </ThemedText>
          {/* The next move, where there is somebody on the other end to make
              it. It sits here rather than three sections down because this is
              the line that raises the question: a traveler standing on a
              street at 22:00 wants to know whether the door is open, and
              asking is the only way left to find out. The actions block below
              gives its Message button up while this one stands, so the page
              never carries the same control twice. */}
          {onMessage ? (
            <PrimaryButton
              variant="tonal"
              label="Message"
              accessibilityLabel={`Message ${name}`}
              onPress={onMessage}
            />
          ) : null}
        </>
      ) : null}
      {hours.length > 0 ? (
        <View style={styles.hours}>
          {shown.map((weekday, index) => (
            <View key={weekday} style={styles.hoursRow}>
              <ThemedText
                type="footnote"
                themeColor={index === 0 ? 'text' : 'textSecondary'}
                style={index === 0 ? styles.strong : undefined}>
                {index === 0 ? 'Today' : weekdayLabel(weekday)}
              </ThemedText>
              <ThemedText
                type="footnote"
                themeColor={index === 0 ? 'text' : 'textSecondary'}
                style={[styles.hoursRange, index === 0 ? styles.strong : null]}>
                {dayRanges(hours, weekday)}
              </ThemedText>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={openWeek ? 'Hide the rest of the week' : 'See the week'}
            hitSlop={12}
            onPress={() => setOpenWeek((open) => !open)}
            style={styles.quietAction}>
            <ThemedText type="footnote" style={{ color: theme.accent }}>
              {openWeek ? 'Hide the rest' : 'See the week'}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      {note ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {note}
        </ThemedText>
      ) : null}
    </Section>
  );
}

function LinkRow({ link, businessId }: { link: BusinessLinkJson; businessId: string }) {
  const theme = useTheme();
  const label = link.label.trim() || LINK_LABEL[link.kind];
  const phone = link.kind === 'phone';
  const email = link.kind === 'email';
  const whatsapp = link.kind === 'whatsapp';
  // A website and a menu are pure reading, so they come up over the screen
  // with a Done button and land the reader back exactly here. Everything else
  // belongs to another app: see opensInAppBrowser for which and why.
  const inApp = opensInAppBrowser(link.kind);
  // What this row cannot promise about where the tap lands. Null for almost
  // every link; a sentence for a shortener, a bare IP address, or a social
  // link filed under a platform it does not go to. See linkCaution.
  const caution = linkCaution(link);

  // The glyph answers the same question as the hint, so it branches on the
  // same predicate. The leaving arrow stayed on the website and menu rows
  // when they stopped leaving, which made the row say two things at once: the
  // spoken hint promised a Done button and the picture promised Safari. A
  // chevron is what every other row in this app uses for "opens here".
  const glyph: SymbolViewProps['name'] = phone
    ? { ios: 'phone.fill', android: 'call', web: 'call' }
    : email
      ? { ios: 'envelope.fill', android: 'mail', web: 'mail' }
      : whatsapp
        ? { ios: 'message.fill', android: 'chat', web: 'chat' }
        : inApp
          ? { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
          : { ios: 'arrow.up.right', android: 'open_in_new', web: 'open_in_new' };

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      // The caution is part of the hint, not decoration on top of it: a
      // sighted reader gets the sentence under the label, and without this a
      // VoiceOver reader would hear "Opens outside the app" and nothing at
      // all about the link hiding its destination.
      accessibilityHint={[
        phone
          ? 'Calls them'
          : email
            ? 'Opens your mail app'
            : whatsapp
              ? 'Opens WhatsApp'
              : inApp
                ? 'Opens here, with a Done button'
                : 'Opens outside the app',
        caution,
      ]
        .filter(Boolean)
        .join('. ')}
      haptic="light"
      scaleTo={0.98}
      onPress={() => {
        // The KIND, never the value. "Somebody called this hostel" is the
        // signal an owner is owed; the phone number itself is the business's
        // own contact detail and has no business leaving the app inside an
        // analytics payload. business_id rides along so a tap can be joined
        // to the page view that produced it - one event, one shape, the
        // lesson features/chat/analytics.ts already wrote down.
        analytics.capture('business_link_tapped', { business_id: businessId, kind: link.kind });
        const href = hrefFor(link);
        // Two openers, two failures, two answers. The old single message
        // ("nothing on this phone opens that kind of link") is true of a
        // tel: or a mailto: with no app behind it, and nonsense about a
        // website that failed to present in a browser this app carries.
        const opening = inApp ? openInAppBrowser(href) : Linking.openURL(href);
        opening.catch(() =>
          inApp
            ? Alert.alert('Could not open that page', 'Check your connection and try again.')
            : Alert.alert('Could not open that', 'Nothing on this phone opens that kind of link.')
        );
      }}
      style={[styles.linkRow, { backgroundColor: theme.surface }]}>
      <View style={styles.linkText}>
        <ThemedText type="callout">{label}</ThemedText>
        {/* The number and the address are worth reading; a web address is
            not, and printing one would make the button a raw URL. A WhatsApp
            link IS a number, so it reads like one. */}
        {phone || email || whatsapp ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {link.value}
          </ThemedText>
        ) : caution ? (
          // Warning, not danger: red is this app's destructive colour and
          // nothing here is destructive. The row still opens - the check that
          // should refuse a link like this belongs at write time, and until
          // it does, saying where the tap goes is the honest half.
          <ThemedText type="footnote" themeColor="warning">
            {caution}
          </ThemedText>
        ) : null}
      </View>
      <SymbolView name={glyph} size={15} tintColor={theme.textSecondary} />
    </PressableScale>
  );
}

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const isGuest = useIsGuest();
  // A business account reaches this page through its own "See it as a
  // traveler" button, and every traveler action on it is a route registered
  // only under the onboarded guard.
  const ownBusiness = useOwnBusiness();
  const detailQuery = useBusinessDetail(id ?? null);
  const place = detailQuery.data ?? null;
  const isOwner = place != null && ownBusiness.data?.id === place.id;
  const isBusinessAccount = ownBusiness.data != null;
  const ratingQuery = useRatingSummary(id ?? null);
  const summary = ratingQuery.data;
  const chatsQuery = useMyChats();
  // 'Plan to go': the pin form, opened from here rather than from the map,
  // pre-filled with this business and posting its id explicitly. The form
  // wants the city's name and clock, which a business row does not carry;
  // the city's own row does, read by id, because since 2026-09-05 a listed
  // business can be in any of the 49,025 cities and not only a launch one.
  const { data: planCityRow = null } = useCity(place?.city_id ?? null);
  const [planning, setPlanning] = useState(false);
  const [planned, setPlanned] = useState(false);

  // The PLACE's clock, not the reader's: somebody in Lisbon reading a Bangkok
  // bar would otherwise be told "Open" seven hours out.
  const now = cityNow(new Date(), place?.lng ?? null);
  const hours = place?.hours ?? [];
  const open = isOpenNow(hours, now);
  const line = openLine(hours, new Date(), place?.lng ?? null);
  // One hierarchy everywhere: Join the chat leads until you are in it.
  const inTheChat =
    place?.chat_id != null && (chatsQuery.data ?? []).some((c) => c.chat_id === place.chat_id);

  // website_url is a column rather than a link row, so a place that filled it
  // in at signup has nothing in `links` to show for it.
  const links: BusinessLinkJson[] = place
    ? place.links.some((l) => l.kind === 'website') || !place.website_url
      ? place.links
      : [
          ...place.links,
          {
            id: 'website-url',
            kind: 'website' as const,
            label: LINK_LABEL.website,
            value: place.website_url,
          },
        ]
    : [];
  const cover = place?.photos[0] ?? null;
  const rest = place?.photos.slice(1) ?? [];

  // An owner is given no reason to open the app on a Tuesday, and until now no
  // return was even recorded: analytics.capture fired nowhere on this page or
  // on the sheet, so the first time the founder wants a Tuesday number there
  // would be no history to draw it from. Three lines, no table, no new column.
  //
  // A disabled query never leaves `isPending` (the same trap the skeleton
  // branch below is written around), and useOwnBusiness is disabled for
  // exactly the accounts that can never own anything: a guest, a signed-out
  // visitor, a dev build with no Supabase keys. So "we know whose listing this
  // is" has to include "nobody is going to ask".
  const ownerKnown = !ownBusiness.isPending || ownBusiness.fetchStatus === 'idle';
  // Once per mount, by ref rather than by deps: the account-kind answer lands
  // a beat after the first paint, and a deps-driven refire would count one
  // reading twice.
  const viewCounted = useRef(false);
  useEffect(() => {
    if (viewCounted.current || place == null || !ownerKnown || isOwner) {
      return;
    }
    viewCounted.current = true;
    // `source` on BOTH surfaces, never on one. The sheet sends 'sheet'; a page
    // that sent nothing would break down as sheet versus undefined, which is
    // the exact shape features/chat/analytics.ts exists to stop.
    analytics.capture('business_page_viewed', { business_id: place.id, source: 'page' });
  }, [isOwner, ownerKnown, place]);

  if (detailQuery.isError) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          <LoadError what="this business" error={detailQuery.error} onRetry={detailQuery.refetch} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  // A disabled query never leaves `isPending`, so an id that never arrived
  // would sit under a skeleton forever instead of saying anything.
  if (detailQuery.isPending && id != null) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          <Skeleton width="100%" aspectRatio={HERO_RATIO} radius={0} />
          <View style={styles.loading}>
            <Skeleton width="70%" height={28} />
            <Skeleton width="45%" height={18} />
            <Skeleton width="90%" height={18} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (place == null) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          <View style={styles.missing}>
            <ThemedText type="callout" themeColor="textSecondary">
              That business is not on the map any more.
            </ThemedText>
            <PrimaryButton variant="ghost" label="Go back" onPress={() => router.back()} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const openMessage = () =>
    router.push({ pathname: '/message-place', params: { id: place.id, name: place.name } });
  // Nobody has said when the door is open. Where somebody actually runs this
  // listing, asking them is the traveler's remaining move, so the Message
  // button goes up beside the gap rather than sitting three sections below it.
  // The actions block gives the same button up while this holds, so the page
  // never carries it twice: it is one control, moved. `isBusinessAccount`
  // covers the owner too, who is a business account by definition.
  const askAboutHours =
    hours.length === 0 && !place.hours_note && place.claimed && !isGuest && !isBusinessAccount;
  const planCity = planCityRow ? browseCityFromCityRow(planCityRow) : null;

  return (
    <ThemedView style={styles.root}>
      {/* The name goes in the bar HERE, not in _layout: it only exists once
          the detail query resolves, and profile/[userId] does the same for
          the same reason. The hero below keeps its copy on purpose: that one
          carries the verified seal and the category line, and a native
          title cannot. */}
      <Stack.Screen options={{ headerTitle: place.name }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView
          // The gesture every phone user reaches for when a screen looks
          // stale. A traveler on a thin business page had no recovery at all
          // short of leaving and coming back, and this page is often read on
          // a hostel's wifi.
          //
          // isRefetching, not isFetching: the first load is already told by
          // the skeletons above, and a spinner sitting at the top of a screen
          // nobody pulled reads as a stuck page.
          refreshControl={
            <RefreshControl
              refreshing={detailQuery.isRefetching || ratingQuery.isRefetching}
              onRefresh={() => {
                void detailQuery.refetch();
                void ratingQuery.refetch();
              }}
              tintColor={theme.textSecondary}
            />
          }
          contentContainerStyle={styles.content}>
          <PlaceImage
            path={cover?.storage_path ?? null}
            label={`Photo of ${place.name}`}
            style={styles.hero}
            fallback={
              <SymbolView
                // The vocabulary table types its glyphs as plain strings;
                // SymbolView wants the SF/Material unions.
                name={CATEGORY_ICON[place.category] as SymbolViewProps['name']}
                size={34}
                tintColor={theme.textTertiary}
              />
            }
          />

          <View style={styles.body}>
            <View style={styles.headBlock}>
              <View style={styles.nameRow}>
                <ThemedText type="title" style={styles.name}>
                  {place.name}
                </ThemedText>
                {place.verified ? <PlaceSeal /> : null}
              </View>

              <View style={styles.metaRow}>
                <ThemedText type="callout" themeColor="textSecondary">
                  {CATEGORY_LABEL[place.category]}
                </ThemedText>
                {line ? (
                  <>
                    {/* Punctuation between two facts, and nothing a screen
                        reader should announce as a word. */}
                    <ThemedText
                      type="callout"
                      themeColor="textTertiary"
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants">
                      ·
                    </ThemedText>
                    <ThemedText type="callout" themeColor={open ? 'success' : 'textSecondary'}>
                      {line}
                    </ThemedText>
                  </>
                ) : null}
              </View>

              {/* Held back until the answer is in, the same as the sheet.
                  `summary == null` is also true while the query is in
                  flight, so without the gate the page says "Not rated yet"
                  for a beat and then says 8.4 — the app contradicting itself
                  on the one number a place is judged by. */}
              {!ratingQuery.isSuccess ? null : summary == null || summary.average == null ? (
                <ThemedText type="callout" themeColor="textSecondary">
                  Not rated yet
                </ThemedText>
              ) : (
                <View style={styles.ratingBlock}>
                  <ThemedText
                    type="headline"
                    accessibilityLabel={`Rated ${summary.average.toFixed(1)} out of 10 by ${countOf(
                      summary.rater_count,
                      'traveler'
                    )}`}>
                    {`${summary.average.toFixed(1)} · ${countOf(summary.rater_count, 'traveler')}`}
                  </ThemedText>
                  {summary.top_tags && summary.top_tags.length > 0 ? (
                    <View style={styles.tagRow}>
                      {summary.top_tags.map((tag) => (
                        <View
                          key={tag}
                          style={[styles.tag, { backgroundColor: theme.surfaceSunken }]}>
                          <ThemedText type="footnote" themeColor="textSecondary">
                            {TAG_LABEL[tag]}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            {place.description ? <ThemedText>{place.description}</ThemedText> : null}

            {place.posts.length > 0 ? (
              <Section
                title="What's on"
                icon={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}>
                {place.posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </Section>
            ) : null}

            {/* Always, now. The section used to be gated on there being hours
                to show, which meant a business that skipped step 9 answered
                "should I go there tonight" with silence, and silence reads as
                a section that failed to load. */}
            <Hours
              hours={hours}
              note={place.hours_note}
              name={place.name}
              onMessage={askAboutHours ? openMessage : null}
            />

            {links.length > 0 ? (
              <Section title="Find and book" icon={{ ios: 'link', android: 'link', web: 'link' }}>
                {links.map((link) => (
                  <LinkRow key={link.id} link={link} businessId={place.id} />
                ))}
              </Section>
            ) : null}

            <Section title="Getting there" icon={{ ios: 'map', android: 'map', web: 'map' }}>
              {/* The address first, then the bit a map cannot tell anyone.
                  Two lines rather than one field doing both jobs: a street
                  number is what you paste into a taxi app, and "blue door"
                  is what stops you walking past it. */}
              {place.address ? <ThemedText type="callout">{place.address}</ThemedText> : null}
              {place.place_label ? (
                <ThemedText type="callout" themeColor="textSecondary">
                  {place.place_label}
                </ThemedText>
              ) : null}
              <PrimaryButton
                variant="ghost"
                label="View in Maps"
                accessibilityLabel={`View ${place.name} in Maps`}
                onPress={() =>
                  openInMaps({
                    lat: place.lat,
                    lng: place.lng,
                    label: place.address ?? place.place_label,
                  })
                }
              />
            </Section>

            {rest.length > 0 ? (
              <Section
                title="Photos"
                icon={{
                  ios: 'photo.on.rectangle',
                  android: 'photo_library',
                  web: 'photo_library',
                }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.strip}>
                  {rest.map((photo) => (
                    <PlaceImage
                      key={photo.id}
                      path={photo.storage_path}
                      label={`Photo of ${place.name}`}
                      style={styles.stripItem}
                    />
                  ))}
                </ScrollView>
              </Section>
            ) : null}

            {isOwner ? (
              // The owner reached this page through their own "See it as a
              // traveler" button. Every control below is a route registered
              // only for a traveler account, so they all did nothing at all
              // when a business pressed them. One honest row instead of four
              // dead buttons.
              <View style={styles.actions}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  This is your listing, as a traveler sees it.
                </ThemedText>
                {/* The one thing an owner standing on this page actually wants
                    to do with it. Same button and same words as the row on My
                    business: one name for one act. */}
                <PrimaryButton
                  variant="ghost"
                  label={LISTING_SHARE_LABEL}
                  accessibilityLabel={`Share ${place.name}`}
                  onPress={() => {
                    shareListing({ id: place.id, name: place.name });
                  }}
                />
                <PrimaryButton
                  variant="ghost"
                  label="Back to My business"
                  accessibilityLabel="Back to My business"
                  onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
                />
              </View>
            ) : isGuest ? (
              // A guest lands here from the map, and every action below is
              // behind an account at the router. Buttons that silently do
              // nothing are worse than the ask, so this is the ask.
              <View style={styles.actions}>
                <SignUpGate
                  reason="Join the chat, plan to go, rate it, or send them a message"
                  where="place"
                />
                {/* Outside the gate on purpose. A guest browsing the map is
                    exactly the person most likely to spot a listing that
                    should not be there, and the ask below names reporting
                    rather than the chat. */}
                <View style={styles.quietRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Report ${place.name}`}
                    hitSlop={12}
                    onPress={() =>
                      Alert.alert(
                        'Report this business',
                        'Make an account first, so we can come back to you about it.'
                      )
                    }
                    style={styles.quietAction}>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Report this business
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : isBusinessAccount ? (
              // Somebody else's listing, read by a business. The reasoning
              // above applies unchanged: /join-place, /rate-place and
              // /message-place are registered only for a traveler account, and
              // report_business refuses a business caller outright. The owner
              // branch got the honest row and this one was left with four dead
              // buttons, which is the same bug one listing over.
              <View style={styles.actions}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  You&apos;re signed in as a business, so this is a look at how another one reads.
                  Joining, rating and messaging belong to travelers.
                </ThemedText>
              </View>
            ) : (
              <View style={styles.actions}>
                {place.chat_id ? (
                  <>
                    {place.member_count > 0 ? (
                      <ThemedText type="footnote" themeColor="textSecondary">
                        {`${countOf(place.member_count, 'person', 'people')} in the chat here`}
                      </ThemedText>
                    ) : null}
                    <PrimaryButton
                      label={inTheChat ? 'Open the chat' : 'Join the chat'}
                      accessibilityLabel={
                        inTheChat
                          ? `Open the chat at ${place.name}`
                          : `Join the chat at ${place.name}`
                      }
                      onPress={() =>
                        inTheChat
                          ? router.push(`/room/${place.chat_id}`)
                          : router.push({
                              pathname: '/join-place',
                              params: {
                                id: place.id,
                                chatId: place.chat_id!,
                                name: place.name,
                              },
                            })
                      }
                    />
                  </>
                ) : null}
                {/* Only where somebody is on the other end. message_business
                    refuses an unclaimed venue, and it does it after five
                    hundred characters have been typed and Send pressed.
                    And only where the Hours section is not already carrying
                    this same button: when nobody has said when the door is
                    open, asking about it is what the tap is FOR, so the
                    control moves up beside the gap instead of appearing
                    twice. See askAboutHours. */}
                {!place.claimed ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Nobody runs this business on Samewhere yet. The chat is open to anyone passing
                    through.
                  </ThemedText>
                ) : askAboutHours ? null : (
                  <PrimaryButton
                    variant="tonal"
                    label="Message"
                    accessibilityLabel={`Message ${place.name}`}
                    onPress={openMessage}
                  />
                )}
                {/* The hero mechanic, from the page that names the venue. "I
                    want to go to X on Y" used to mean leaving this page,
                    finding the spot on the map and retyping X. The form
                    opens here, pre-filled, and posts the business's id with
                    the pin (map-pins-link-to-a-business, the half that
                    shipped without an entry point). Hidden until the launch
                    cities have loaded, because the form needs the city's
                    name and clock; a button that opened a half-filled form
                    would be worse than one that arrives a beat later. */}
                {planCity ? (
                  planned ? (
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Your plan is on the map. It disappears on its own.
                    </ThemedText>
                  ) : (
                    <PrimaryButton
                      variant="tonal"
                      label="Plan to go"
                      accessibilityLabel={`Plan to go to ${place.name}`}
                      accessibilityHint="Opens the pin form with this business filled in"
                      onPress={() => {
                        haptics.light();
                        setPlanning(true);
                      }}
                    />
                  )
                ) : null}
                {/* Its own button, not a footnote beside Report. Rating is
                    the feature; reporting is the safety valve. They were the
                    same size, in the same row, below the fold. */}
                <PrimaryButton
                  variant="ghost"
                  label="Rate this business"
                  accessibilityLabel={`Rate ${place.name}`}
                  onPress={() =>
                    router.push({
                      pathname: '/rate-place',
                      params: { id: place.id, name: place.name, category: place.category },
                    })
                  }
                />
                {/* A traveler who liked a hostel is the cheapest way another
                    traveler hears about it, and until now the app could share
                    a group chat and nothing else. Ghost, below the two things
                    a traveler came here to do. */}
                <PrimaryButton
                  variant="ghost"
                  label={LISTING_SHARE_LABEL}
                  accessibilityLabel={`Share ${place.name}`}
                  onPress={() => {
                    shareListing({ id: place.id, name: place.name });
                  }}
                />
                <View style={styles.quietRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Report ${place.name}`}
                    hitSlop={12}
                    onPress={() =>
                      router.push({
                        pathname: '/report-place',
                        params: { id: place.id, name: place.name },
                      })
                    }
                    style={styles.quietAction}>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Report this business
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      {/* The same sheet the map presents, over this page instead. Nothing
          navigates from inside it: posting closes it and the line above
          takes the button's place, so the scrim-survives-a-push trap
          (traps: leavingSheet) has nothing to bite. The address rides along
          because the form's own reverse geocode is skipped for a business,
          which already knows its street. */}
      {planning && planCity ? (
        <PinFormSheet
          cityId={place.city_id}
          cityName={planCity.cities.name}
          cityTimezone={planCity.timezone}
          coords={{ lat: place.lat, lng: place.lng }}
          business={{
            id: place.id,
            name: place.name,
            category: place.category,
            address: place.address,
          }}
          onClose={() => setPlanning(false)}
          onPosted={() => {
            setPlanning(false);
            setPlanned(true);
          }}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingBottom: Space.xxl,
  },
  loading: {
    gap: Space.md,
    padding: Space.lg,
  },
  missing: {
    flex: 1,
    gap: Space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  frame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  hero: {
    width: '100%',
    aspectRatio: HERO_RATIO,
  },
  body: {
    gap: Space.xl,
    padding: Space.lg,
  },
  headBlock: {
    gap: Space.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  name: {
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Space.sm,
  },
  ratingBlock: {
    gap: Space.sm,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  tag: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  section: {
    gap: Space.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  card: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  cardBody: {
    gap: Space.xs,
    padding: Space.md,
  },
  postPhoto: {
    width: '100%',
    aspectRatio: HERO_RATIO,
  },
  hours: {
    gap: Space.xs,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Space.lg,
  },
  hoursRange: {
    flexShrink: 1,
    textAlign: 'right',
  },
  strong: {
    fontWeight: '600',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  linkText: {
    flex: 1,
    gap: 2,
  },
  strip: {
    gap: Space.sm,
    paddingRight: Space.lg,
  },
  stripItem: {
    width: 140,
    aspectRatio: HERO_RATIO,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  actions: {
    gap: Space.md,
  },
  quietRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.lg,
  },
  quietAction: {
    minHeight: HitTarget,
    justifyContent: 'center',
  },
});
