import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import { PressableScale } from '@/components/ui/pressable-scale';
import type { Section as EditSection } from '@/app/business-edit';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BottomTabInset,
  HitTarget,
  MaxContentWidth,
  Radius,
  Space,
  type ThemeColor,
} from '@/constants/theme';
import {
  useArchiveBusinessPost,
  useBusinessDetail,
  useLatestStorefrontCheck,
  useOwnBusiness,
  useRatingSummary,
} from '@/features/business/hooks';
import { CATEGORY_ICON, CATEGORY_LABEL, TAG_LABEL, openLine } from '@/features/business/vocabulary';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { dayLabel } from '@/features/chat/separators';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import type { BusinessPostJson, MyBusinessRow } from '@/lib/database.types';
import { countOf } from '@/lib/plural';
import { isSupabaseConfigured } from '@/lib/supabase';

const TIME = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false });

const HERO_RATIO = 3 / 2;

/** Room under the scroll for the docked button and the tab bar beneath it. */
const DOCK_CLEARANCE = 120;

/** PrimaryButton's filled height, which the backdrop has to cover exactly. */
const DOCK_BUTTON = 52;

/**
 * Where the listing stands, in a few words a person already understands.
 *
 * `flagged` and `removed` share one chip rather than earning their own: it
 * says whether travelers can find you, and in both of those the answer is no.
 * What differs is WHY, and that belongs in the row underneath, where there is
 * room for a sentence and a way to answer back.
 *
 * NOT "Paused". There is no pause control anywhere in the app, so the neutral
 * word told an owner they had turned their own listing off when in fact
 * moderation had taken it down.
 */
function statusOf(business: MyBusinessRow): { label: string; tone: ThemeColor } {
  if (business.state === 'unconfirmed') {
    return { label: 'Waiting on your email', tone: 'warning' };
  }
  if (business.state === 'listed' && business.active) {
    return { label: 'Live on the map', tone: 'success' };
  }
  return { label: 'Off the map', tone: 'warning' };
}

/**
 * The check beside a verified name.
 *
 * The same words the place page uses, because it is the same badge and a
 * business reading two different explanations of it would rightly wonder
 * which one travelers get.
 */
function VerifiedCheck() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      // "Verified business" is the LABEL and the explanation is the hint, the
      // same order the traveler-facing seal uses. The other way round,
      // VoiceOver never announced that the place is verified at all — only
      // that there was a button explaining something.
      accessibilityLabel="Verified business"
      accessibilityHint="What the check means"
      // 14 + 15 + 15 = 44 on a glyph that draws at 14.
      hitSlop={Math.ceil((HitTarget - 14) / 2)}
      onPress={() =>
        Alert.alert(
          'Verified business',
          'Somebody stood outside and sent us two photos of the front. We checked them against the spot on the map.'
        )
      }>
      <SymbolView
        name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
        size={16}
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

/**
 * One live post, as the owner sees it. Tap it to take it down.
 *
 * The tap is not a nicety. The cap is three live posts unverified and ten
 * verified, and one of the three shapes a post can take is "keep it up until
 * I take it down" — so without a way down, a new place could put up three
 * standing notices and permanently brick its own composer, which then told
 * it to "take one down" with nowhere in the app to do it.
 *
 * An alert rather than a route: there is one thing to do to a post, and a
 * whole screen to host one destructive button is more ceremony than the
 * decision deserves.
 */
function PostCard({ post, onTakeDown }: { post: BusinessPostJson; onTakeDown: () => void }) {
  const at = post.happens_at ? new Date(post.happens_at) : null;
  const today = at != null && at.toDateString() === new Date().toDateString();
  const theme = useTheme();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${post.title}. Take it down.`}
      scaleTo={0.99}
      haptic="soft"
      onPress={() =>
        Alert.alert('Take this down?', post.title, [
          { text: 'Keep it up', style: 'cancel' },
          { text: 'Take it down', style: 'destructive', onPress: onTakeDown },
        ])
      }>
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <View style={styles.cardBody}>
          {at && post.happens_at ? (
            // Warm light is this app's "happening now", the same signal the map
            // puts on a place with something on tonight.
            <ThemedText type="caption" themeColor={today ? 'highlight' : 'textSecondary'}>
              {`${dayLabel(post.happens_at)} · ${TIME.format(at)}`}
            </ThemedText>
          ) : null}
          <ThemedText type="callout">{post.title}</ThemedText>
          {post.body ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={3}>
              {post.body}
            </ThemedText>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

/** One line of Your details, and the editor it opens. */
function DetailRow({
  label,
  value,
  icon,
  section,
  onPress,
}: {
  label: string;
  value: string;
  icon: SymbolViewProps['name'];
  /** The editor section this row jumps to. Omit and pass `onPress` instead. */
  section?: EditSection;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={onPress ? label : `Edit ${label.toLowerCase()}`}
      accessibilityHint={value}
      haptic="light"
      scaleTo={0.98}
      onPress={
        onPress ??
        (() => router.push({ pathname: '/business-edit', params: { section: section! } }))
      }
      style={[styles.row, { backgroundColor: theme.surface }]}>
      <SymbolView name={icon} size={16} tintColor={theme.textSecondary} />
      <View style={styles.rowText}>
        <ThemedText type="callout">{label}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
          {value}
        </ThemedText>
      </View>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={14}
        tintColor={theme.textTertiary}
      />
    </PressableScale>
  );
}

/**
 * The owner's side of a listing, in the slot Travelers occupies for a person.
 *
 * The traveler's page (`/place/[id]`) is this same listing read from outside,
 * and the button near the bottom opens exactly that rather than a preview
 * assembled from the same data by different code. It is the honesty rule the
 * profile already follows: the only way to know what a stranger sees is to
 * look at the thing a stranger sees.
 */
export default function MyBusinessScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const ownQuery = useOwnBusiness();
  const business = ownQuery.data ?? null;
  const detailQuery = useBusinessDetail(business?.id ?? null);
  // What the storefront check is doing right now, so this screen stops asking
  // for photos that are already in the queue.
  const storefront = useLatestStorefrontCheck(business?.id ?? null).data?.status ?? null;
  const archivePost = useArchiveBusinessPost(business?.id ?? null);
  const detail = detailQuery.data ?? null;
  const ratingQuery = useRatingSummary(business?.id ?? null);
  const rating = ratingQuery.data ?? null;
  const cover = useBusinessPhotoUrl(detail?.photos[0]?.storage_path ?? null);

  // One reading of the clock per data change rather than one per render, so
  // the Hours row cannot flip from open to closed mid-scroll.
  const hoursLine = useMemo(
    () => (detail ? openLine(detail.hours, new Date(), detail.lng) : null),
    [detail]
  );

  useEffect(() => {
    analytics.capture('my_business_viewed');
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'storefront', android: 'storefront', web: 'storefront' }}
        title="My business"
        phase="waiting on backend keys"
        description="Add Supabase keys to .env to put a business on the map."
      />
    );
  }

  if (ownQuery.isError) {
    return (
      <ThemedView style={styles.root}>
        <View style={styles.column}>
          <LoadError what="your business" error={ownQuery.error} onRetry={ownQuery.refetch} />
        </View>
      </ThemedView>
    );
  }

  if (ownQuery.isPending) {
    return (
      <ThemedView style={styles.root}>
        <View style={styles.column}>
          <Skeleton width="100%" aspectRatio={HERO_RATIO} radius={0} />
          <View style={styles.loading}>
            <Skeleton width="65%" height={28} />
            <Skeleton width="40%" height={18} />
            <Skeleton width="85%" height={18} />
          </View>
        </View>
      </ThemedView>
    );
  }

  // The tab only exists for an account that owns a listing, so this is the
  // refetch-came-back-empty case rather than a state anybody navigates into.
  // Still worth a sentence: a blank tab is how a person concludes the app
  // lost their place.
  if (business == null) {
    return (
      <ThemedView style={styles.root}>
        <View style={[styles.column, styles.centred]}>
          <ThemedText type="callout" themeColor="textSecondary" style={styles.centredText}>
            {"We can't find your business right now."}
          </ThemedText>
          <PrimaryButton variant="ghost" label="Try again" onPress={() => ownQuery.refetch()} />
        </View>
      </ThemedView>
    );
  }

  const status = statusOf(business);
  const posts = detail?.posts ?? [];
  const photos = detail?.photos ?? [];
  const links = detail?.links ?? [];
  const dark = business.state !== 'listed' || !business.active;

  return (
    <ThemedView style={styles.root}>
      <View style={styles.column}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: BottomTabInset + DOCK_CLEARANCE },
          ]}
          showsVerticalScrollIndicator={false}>
          {/* No header above it: the cover IS the header, and a business
              opening this tab should see the picture travelers see first. */}
          <View
            style={[styles.hero, { backgroundColor: theme.surfaceSunken, paddingTop: insets.top }]}>
            {cover.data ? (
              <>
                <Image
                  source={{ uri: cover.data }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={180}
                />
                {/* This tab carries no navigation header, so the cover runs
                    under the status bar and the clock lands on whatever the
                    photo happens to be. PhotoScrim ramps the wrong way for
                    that, so this is its mirror, and short enough to darken
                    the bar rather than the picture. */}
                <LinearGradient
                  colors={[theme.scrim, 'transparent']}
                  style={[styles.statusScrim, { height: insets.top + Space.md }]}
                  pointerEvents="none"
                />
              </>
            ) : (
              <SymbolView
                // The vocabulary table types its glyphs as plain strings;
                // SymbolView wants the SF/Material unions.
                name={CATEGORY_ICON[business.category] as SymbolViewProps['name']}
                size={34}
                tintColor={theme.textTertiary}
              />
            )}
          </View>

          <View style={styles.body}>
            <View style={styles.headBlock}>
              <View style={styles.nameRow}>
                <ThemedText type="title" style={styles.name}>
                  {business.name}
                </ThemedText>
                {business.verified ? <VerifiedCheck /> : null}
              </View>
              <View style={styles.metaRow}>
                <ThemedText type="callout" themeColor="textSecondary">
                  {CATEGORY_LABEL[business.category]}
                </ThemedText>
                <View style={[styles.chip, { backgroundColor: theme.surfaceSunken }]}>
                  <ThemedText type="caption" themeColor={status.tone}>
                    {status.label}
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* The one thing standing between this place and the map, and
                nothing else. Two asks stacked here would make both of them
                optional-looking. */}
            {business.state === 'unconfirmed' ? (
              <View style={[styles.notice, { backgroundColor: theme.surface }]}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {
                    "We sent a code to your business email. Travelers can't find you until it goes in."
                  }
                </ThemedText>
                <PrimaryButton
                  label="Confirm your email"
                  accessibilityLabel="Confirm your business email"
                  onPress={() => router.push('/business-email')}
                />
              </View>
            ) : business.state === 'flagged' || business.state === 'removed' ? (
              <View style={[styles.notice, { backgroundColor: theme.surface }]}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {business.state === 'flagged'
                    ? "We're taking a look at this listing."
                    : 'This listing is off the map.'}
                </ThemedText>
                <PrimaryButton
                  variant="tonal"
                  label="Contact us"
                  accessibilityLabel="Contact us about this listing"
                  onPress={() => router.push('/contact')}
                />
              </View>
            ) : !business.verified ? (
              <View style={[styles.notice, { backgroundColor: theme.surface }]}>
                {/* The dashboard is where an owner comes back to, so it has
                    to know a check is already in flight. Without this it
                    kept asking for photos that had already been sent, for as
                    long as the verdict took. */}
                <ThemedText type="footnote" themeColor="textSecondary">
                  {storefront === 'pending'
                    ? "We're having a look at your photos. This usually takes a minute."
                    : storefront === 'uncertain'
                      ? "Someone is checking your photos by hand. We'll email you when they have."
                      : storefront === 'rejected'
                        ? "Those photos didn't pass. Have another go, with the sign in frame."
                        : 'Send two photos of the front and the check goes beside your name.'}
                </ThemedText>
                {storefront === 'pending' || storefront === 'uncertain' ? null : (
                  <PrimaryButton
                    variant="tonal"
                    // The label the destination wears. Three names for one
                    // action across two screens is how a person loses track
                    // of what they already did.
                    label="Show us the front"
                    accessibilityLabel="Show us the front with two photos"
                    onPress={() => router.push('/business-storefront')}
                  />
                )}
              </View>
            ) : null}

            {detailQuery.isError ? (
              <LoadError
                compact
                what="the rest of your listing"
                error={detailQuery.error}
                onRetry={detailQuery.refetch}
              />
            ) : detailQuery.isPending || ratingQuery.isPending ? (
              // Shapes, not empty states. Every row below reads "Nothing yet"
              // before its query lands, and telling a business it has no
              // hours, no links and no rating while we are still asking is
              // the same lie LoadError exists to stop.
              <View style={styles.loadingSections}>
                <Skeleton width="35%" height={14} />
                <Skeleton height={56} />
                <Skeleton width="35%" height={14} />
                <Skeleton height={180} />
              </View>
            ) : (
              <>
                <Section
                  title="What's on"
                  icon={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}>
                  {posts.length > 0 ? (
                    posts.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        onTakeDown={() => {
                          archivePost.mutate(post.id);
                        }}
                      />
                    ))
                  ) : (
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {
                        "Nothing on right now. A quiz night, a happy hour, whatever's happening this week."
                      }
                    </ThemedText>
                  )}
                </Section>

                <Section
                  title="Your details"
                  icon={{ ios: 'list.bullet', android: 'list', web: 'list' }}>
                  <DetailRow
                    label="Hours"
                    section="hours"
                    icon={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                    value={hoursLine ?? 'Nothing yet'}
                  />
                  <DetailRow
                    label="Links"
                    section="links"
                    icon={{ ios: 'link', android: 'link', web: 'link' }}
                    value={links.length > 0 ? countOf(links.length, 'link') : 'Nothing yet'}
                  />
                  <DetailRow
                    label="Description"
                    // 'details', not 'description': business-edit's Section
                    // union has no such member, and measure() compares by
                    // equality, so the editor opened at the top instead of
                    // scrolling to the field the row named.
                    section="details"
                    icon={{ ios: 'text.alignleft', android: 'notes', web: 'notes' }}
                    value={business.description ?? 'Nothing yet'}
                  />
                  <DetailRow
                    label="Photos"
                    section="photos"
                    icon={{
                      ios: 'photo.on.rectangle',
                      android: 'photo_library',
                      web: 'photo_library',
                    }}
                    value={photos.length > 0 ? countOf(photos.length, 'photo') : 'Nothing yet'}
                  />
                </Section>

                {/* The way into their own room. It appears in the Chat tab
                    too, but this is the screen an owner opens, and nothing
                    here pointed at the one place travelers gather. */}
                {business.chat_id ? (
                  <Section
                    title="Your chat"
                    icon={{ ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' }}>
                    <DetailRow
                      label="Open your chat"
                      icon={{ ios: 'bubble.left', android: 'chat', web: 'chat' }}
                      value={
                        detail && detail.member_count > 0
                          ? `${countOf(detail.member_count, 'person', 'people')} here`
                          : 'Nobody in yet'
                      }
                      onPress={() => router.push(`/room/${business.chat_id}`)}
                    />
                  </Section>
                ) : null}

                <Section
                  title="Your rating"
                  icon={{ ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' }}>
                  {rating?.average == null ? (
                    // The floor, said as a fact rather than as an apology.
                    // Which travelers rated you is never shown here and never
                    // will be: that is the anti-retaliation control, not an
                    // omission somebody should try to fill in later.
                    <ThemedText type="footnote" themeColor="textSecondary">
                      Not rated yet. It shows once five travelers have rated you.
                    </ThemedText>
                  ) : (
                    <View style={styles.ratingBlock}>
                      <ThemedText
                        type="display"
                        accessibilityLabel={`Rated ${rating.average.toFixed(1)} out of 10 by ${countOf(
                          rating.rater_count,
                          'traveler'
                        )}`}>
                        {rating.average.toFixed(1)}
                      </ThemedText>
                      <ThemedText
                        type="footnote"
                        themeColor="textSecondary"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants">
                        {countOf(rating.rater_count, 'traveler')}
                      </ThemedText>
                      {rating.top_tags && rating.top_tags.length > 0 ? (
                        <View style={styles.tagRow}>
                          {rating.top_tags.map((tag) => (
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
                </Section>
              </>
            )}

            <View style={styles.seeItBlock}>
              <PrimaryButton
                variant="ghost"
                label="See it as a traveler"
                accessibilityLabel={`See ${business.name} as a traveler`}
                onPress={() => router.push(`/place/${business.id}`)}
              />
              {dark ? (
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.centredText}>
                  Only you can see it while the listing is off the map.
                </ThemedText>
              ) : null}
            </View>
          </View>
        </ScrollView>

        {/* The button lives outside the scroll on purpose: a primary action
            inside one is reachable only by scrolling to it, and this is the
            thing a business opens the tab to do. The gradient gives it a
            ground so the text passing underneath does not compete with the
            label on top of it. */}
        <LinearGradient
          colors={['transparent', theme.background]}
          locations={[0, 0.55]}
          style={[styles.dockBackdrop, { height: dockHeight(insets.bottom) + Space.xxl }]}
          pointerEvents="none"
        />
        <View
          style={[styles.dock, { paddingBottom: BottomTabInset + insets.bottom / 2 + Space.sm }]}
          pointerEvents="box-none">
          <PrimaryButton
            label="Post something"
            accessibilityLabel={`Post something at ${business.name}`}
            onPress={() => router.push('/business-post')}
          />
        </View>
      </View>
    </ThemedView>
  );
}

/**
 * How tall the docked bar actually is, so the fade starts AT it rather than
 * a line and a half above it. Handing this the scroll clearance instead is
 * what dissolved the last line of a traveler's trip dates on run 44.
 */
function dockHeight(bottomInset: number) {
  return Space.sm + DOCK_BUTTON + Space.sm + BottomTabInset + bottomInset / 2;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  // flex: 1 of its own, or it collapses to content height inside the row and
  // the docked bar anchors to the wrong bottom.
  column: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingBottom: Space.xxl,
  },
  loading: {
    gap: Space.md,
    padding: Space.lg,
  },
  loadingSections: {
    gap: Space.md,
  },
  centred: {
    gap: Space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  centredText: {
    textAlign: 'center',
  },
  hero: {
    width: '100%',
    aspectRatio: HERO_RATIO,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  statusScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
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
  chip: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  notice: {
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  rowText: {
    flex: 1,
    gap: 2,
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
  seeItBlock: {
    gap: Space.sm,
  },
  dockBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
  },
});
