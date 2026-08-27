import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import { PressableScale } from '@/components/ui/pressable-scale';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { Skeleton } from '@/components/ui/skeleton';
import { HitTarget, MaxContentWidth, Radius, Space } from '@/constants/theme';
import { useBusinessDetail, useRatingSummary } from '@/features/business/hooks';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  LINK_LABEL,
  TAG_LABEL,
  isOpenNow,
  openLine,
  shortTime,
  weekdayLabel,
} from '@/features/business/vocabulary';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { dayLabel } from '@/features/chat/separators';
import { useIsGuest } from '@/features/guest/hooks';
import { useMyChats } from '@/features/matching/hooks';
import { openInMaps } from '@/features/pins/open-in-maps';
import { useTheme } from '@/hooks/use-theme';
import type { BusinessHourJson, BusinessLinkJson, BusinessPostJson } from '@/lib/database.types';
import { countOf } from '@/lib/plural';

/** 24-hour, so an event time reads next to "Open · till 2:00" as one clock. */
const TIME = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false });

const HERO_RATIO = 3 / 2;

function PlaceImage({
  path,
  style,
  fallback,
}: {
  path: string | null;
  style?: StyleProp<ViewStyle>;
  fallback?: ReactNode;
}) {
  const theme = useTheme();
  const { data: url } = useBusinessPhotoUrl(path);
  return (
    <View style={[styles.frame, { backgroundColor: theme.surfaceSunken }, style]}>
      {url ? (
        <Image source={{ uri: url }} style={styles.fill} contentFit="cover" transition={180} />
      ) : (
        fallback
      )}
    </View>
  );
}

/**
 * The check beside a verified name.
 *
 * Not `VerifiedSeal`: that one explains a live selfie compared against a
 * person's photos, which is the wrong thing to tell somebody about a bar.
 * What a place earned is two camera shots of its own front door, so that is
 * what the tap says. And there is deliberately no counterpart for a place
 * without one - an "unverified" chip would be a mark against every honest
 * place that has not got round to it yet.
 */
function VerifiedCheck() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      // "Verified place", not "verified business": travelers never see that
      // second word, and the place sheet already says it this way.
      accessibilityLabel="Verified place"
      accessibilityHint="What the check means"
      // 14 + 15 + 15 = 44 on a glyph that draws at 14.
      hitSlop={Math.ceil((HitTarget - 14) / 2)}
      onPress={() =>
        Alert.alert(
          'Verified',
          'Somebody stood outside and sent us two photos of the front. We checked them against the spot on the map.'
        )
      }>
      <SymbolView
        name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
        size={14}
        tintColor={theme.accent}
      />
    </Pressable>
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
      {post.photo_path ? <PlaceImage path={post.photo_path} style={styles.postPhoto} /> : null}
      <View style={styles.cardBody}>
        {at && when ? (
          // Warm light is this app's "happening now", the same signal the map
          // puts on a place with something on tonight.
          <ThemedText type="caption" themeColor={today ? 'highlight' : 'textSecondary'}>
            {`${dayLabel(when)} · ${TIME.format(at)}`}
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

function Hours({ hours, note }: { hours: BusinessHourJson[]; note: string | null }) {
  const theme = useTheme();
  const [openWeek, setOpenWeek] = useState(false);
  // Starting at today rather than at Monday: the row somebody came for is the
  // one they are standing in, and every map app they already use does this.
  const today = new Date().getDay();
  const week = Array.from({ length: 7 }, (_, offset) => (today + offset) % 7);
  const shown = openWeek ? week : week.slice(0, 1);

  return (
    <Section title="Hours" icon={{ ios: 'clock', android: 'schedule', web: 'schedule' }}>
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

/**
 * Where a link actually goes.
 *
 * The scheme fallback is the one that matters: a place types "example.com"
 * into its own listing, and `openURL` on a string with no scheme does
 * nothing at all - which on the screen is indistinguishable from a dead
 * button.
 */
function hrefFor(link: BusinessLinkJson): string {
  const value = link.value.trim();
  if (link.kind === 'phone') {
    return `tel:${value.replace(/\s/g, '')}`;
  }
  if (link.kind === 'email') {
    return `mailto:${value}`;
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}

function LinkRow({ link }: { link: BusinessLinkJson }) {
  const theme = useTheme();
  const label = link.label.trim() || LINK_LABEL[link.kind];
  const phone = link.kind === 'phone';
  const email = link.kind === 'email';
  const glyph: SymbolViewProps['name'] = phone
    ? { ios: 'phone.fill', android: 'call', web: 'call' }
    : email
      ? { ios: 'envelope.fill', android: 'mail', web: 'mail' }
      : { ios: 'arrow.up.right', android: 'open_in_new', web: 'open_in_new' };

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        phone ? 'Calls them' : email ? 'Opens your mail app' : 'Opens outside the app'
      }
      haptic="light"
      scaleTo={0.98}
      onPress={() =>
        Linking.openURL(hrefFor(link)).catch(() =>
          Alert.alert('Could not open that', 'Nothing on this phone opens that kind of link.')
        )
      }
      style={[styles.linkRow, { backgroundColor: theme.surface }]}>
      <View style={styles.linkText}>
        <ThemedText type="callout">{label}</ThemedText>
        {/* The number and the address are worth reading; a web address is
            not, and printing one would make the button a raw URL. */}
        {phone || email ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {link.value}
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
  const detailQuery = useBusinessDetail(id ?? null);
  const place = detailQuery.data ?? null;
  const { data: summary } = useRatingSummary(id ?? null);
  const chatsQuery = useMyChats();

  const now = new Date();
  const hours = place?.hours ?? [];
  const open = isOpenNow(hours, now);
  const line = openLine(hours, now);
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

  if (detailQuery.isError) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          <LoadError what="this place" error={detailQuery.error} onRetry={detailQuery.refetch} />
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
          <Skeleton height={220} radius={0} />
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
              That place is not on the map any more.
            </ThemedText>
            <PrimaryButton variant="ghost" label="Go back" onPress={() => router.back()} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <PlaceImage
            path={cover?.storage_path ?? null}
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
                {place.verified ? <VerifiedCheck /> : null}
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

              {summary == null || summary.average == null ? (
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

            {hours.length > 0 || place.hours_note ? (
              <Hours hours={hours} note={place.hours_note} />
            ) : null}

            {links.length > 0 ? (
              <Section title="Find and book" icon={{ ios: 'link', android: 'link', web: 'link' }}>
                {links.map((link) => (
                  <LinkRow key={link.id} link={link} />
                ))}
              </Section>
            ) : null}

            <Section title="Getting there" icon={{ ios: 'map', android: 'map', web: 'map' }}>
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
                  openInMaps({ lat: place.lat, lng: place.lng, label: place.place_label })
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
                    <PlaceImage key={photo.id} path={photo.storage_path} style={styles.stripItem} />
                  ))}
                </ScrollView>
              </Section>
            ) : null}

            {isGuest ? (
              // A guest lands here from the map, and every action below is
              // behind an account at the router. Buttons that silently do
              // nothing are worse than the ask, so this is the ask.
              <SignUpGate reason="Join the chat, or send them a message" where="place" />
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
                          : router.push({ pathname: '/join-place', params: { id: place.id } })
                      }
                    />
                  </>
                ) : null}
                <PrimaryButton
                  variant="tonal"
                  label="Message"
                  accessibilityLabel={`Message ${place.name}`}
                  onPress={() =>
                    router.push({ pathname: '/message-place', params: { id: place.id } })
                  }
                />
                <View style={styles.quietRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Report ${place.name}`}
                    hitSlop={12}
                    onPress={() =>
                      router.push({ pathname: '/report-place', params: { id: place.id } })
                    }
                    style={styles.quietAction}>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Report this place
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Rate ${place.name}`}
                    hitSlop={12}
                    onPress={() =>
                      router.push({ pathname: '/rate-place', params: { id: place.id } })
                    }
                    style={styles.quietAction}>
                    <ThemedText type="footnote" style={{ color: theme.accent }}>
                      Rate it
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
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
    aspectRatio: 16 / 9,
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
    aspectRatio: 4 / 3,
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
