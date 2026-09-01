import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import { DockedActionBar, dockedActionBarHeight } from '@/components/ui/docked-action-bar';
import { PressableScale } from '@/components/ui/pressable-scale';
import type { Section as EditSection } from '@/app/business-edit';
import { Skeleton } from '@/components/ui/skeleton';
import {
  HitTarget,
  MaxContentWidth,
  Motion,
  Radius,
  Space,
  type ThemeColor,
} from '@/constants/theme';
import {
  useArchiveBusinessPost,
  useBusinessCodeStatus,
  useBusinessDetail,
  useLatestStorefrontCheck,
  useOwnBusiness,
  useRatingSummary,
} from '@/features/business/hooks';
import {
  LISTING_QR_CAPTION,
  LISTING_SHARE_LABEL,
  listingShareMessage,
  listingUrl,
  shareListing,
} from '@/features/business/share-listing';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  TAG_LABEL,
  countChatsSince,
  detailsDone,
  openLine,
  weekLine,
} from '@/features/business/vocabulary';
import { useBusinessPhotos } from '@/features/business/business-photos';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { useMyChats } from '@/features/matching/hooks';
import { ShareLink } from '@/features/share/share-link';
import { dayLabel } from '@/features/chat/separators';
import { usePushPrimer } from '@/features/notifications/primer-store';
import {
  notificationValueLine,
  useNotificationPermission,
} from '@/features/notifications/notifications-row';
import { useTabDockBottom } from '@/hooks/use-tab-bar-inset';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import type { BusinessPostJson, MyBusinessRow } from '@/lib/database.types';
import { countOf } from '@/lib/plural';
import { isSupabaseConfigured } from '@/lib/supabase';

const TIME = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false });

const HERO_RATIO = 3 / 2;

/** Twenty minutes, which is what the migration gives a code. */
const CODE_TTL_MS = 20 * 60 * 1000;

/**
 * Whether the last code has run out, without reading the clock during render.
 *
 * The dashboard is the screen an owner comes back to days later, and it went
 * on saying a code had been sent to an inbox that had nothing in it. Same
 * shape as the code screen's own hook (app/business-email.tsx): the timer is
 * set for the exact minute the code dies, so a screen left open changes its
 * own words rather than lying until the next tap, and nothing calls setState
 * in the effect body.
 */
function useCodeRunOut(sentAt: string | null | undefined): boolean {
  const sentAtMs = sentAt != null ? Date.parse(sentAt) : null;
  const [runOutFor, setRunOutFor] = useState<number | null>(null);
  useEffect(() => {
    if (sentAtMs == null || Number.isNaN(sentAtMs)) {
      return;
    }
    const left = sentAtMs + CODE_TTL_MS - Date.now();
    const timer = setTimeout(() => setRunOutFor(sentAtMs), Math.max(left, 0));
    return () => clearTimeout(timer);
  }, [sentAtMs]);
  return sentAtMs != null && runOutFor === sentAtMs;
}

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
/**
 * One live post, and the three things an owner can do to it.
 *
 * The card used to have exactly one action - take it down - so a typo in a
 * quiz night's time could only be answered by deleting the post and writing
 * it again from nothing, and last week's quiz night could not go back up at
 * all. business-post.tsx has supported both since biz-post-edit-and-repeat
 * (`postId` opens a post to be fixed, `postId + again` copies its words onto
 * a new row with a date somebody has to look at), but nothing in the app
 * navigated to it with either param, so the whole screen was reachable only
 * as a blank composer and every string written for the other two was dead.
 *
 * An alert rather than three buttons on the card: the card is a summary and
 * the actions are all one tap deep, which is the shape "Take this down?"
 * already had. Fix it first because it is the commonest and the least
 * destructive; take it down stays last and stays the only destructive one.
 */
function PostCard({
  post,
  onTakeDown,
  onFix,
  onAgain,
}: {
  post: BusinessPostJson;
  onTakeDown: () => void;
  onFix: () => void;
  onAgain: () => void;
}) {
  const at = post.happens_at ? new Date(post.happens_at) : null;
  const today = at != null && at.toDateString() === new Date().toDateString();
  const theme = useTheme();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${post.title}. Fix it, put it up again, or take it down.`}
      scaleTo={0.99}
      haptic="soft"
      onPress={() =>
        Alert.alert(post.title, undefined, [
          { text: 'Fix it', onPress: onFix },
          { text: 'Put it up again', onPress: onAgain },
          { text: 'Take it down', style: 'destructive', onPress: onTakeDown },
          { text: 'Cancel', style: 'cancel' },
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
  // Neither a section nor a handler: the row is information, and it renders
  // inert - no scale, no haptic, no button role. A full press affordance
  // that silently does nothing is the pattern this screen exists to remove.
  const press =
    onPress ??
    (section ? () => router.push({ pathname: '/business-edit', params: { section } }) : undefined);
  return (
    <PressableScale
      accessibilityRole={press ? 'button' : 'text'}
      accessibilityLabel={onPress ? label : section ? `Edit ${label.toLowerCase()}` : label}
      accessibilityHint={value}
      haptic={press ? 'light' : 'none'}
      scaleTo={press ? 0.98 : 1}
      disabled={press == null}
      onPress={press ?? (() => {})}
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
  // Dynamic Type grows the native tab bar; the constants it replaces did not.
  const dockBottom = useTabDockBottom();
  // The dock's real height, measured by the bar (it grows with Dynamic
  // Type). Seeded from the shared formula so the first frame is right; the
  // measurement only corrects it. Feeds the scroll clearance, so the last
  // rows can never run under the button again.
  const [barHeight, setBarHeight] = useState(() => dockedActionBarHeight(dockBottom));
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
  // Whether the code we told this owner to look for is still a code. Asked
  // only while the listing is waiting on one, and the query stops polling as
  // soon as the answer is in.
  const delivery = useBusinessCodeStatus(business?.state === 'unconfirmed').data;
  const codeRunOut = useCodeRunOut(delivery?.sent_at);
  const codeBounced = delivery?.failed === true;
  // The live OS state for the Notifications row below. Same hook as the
  // account pages, so the two renderings can never disagree.
  const { state: pushState, enable: enablePush } = useNotificationPermission();
  // The one signal on this screen that comes back from the world rather than
  // out of the owner's own typing. Conversations, never senders: see
  // vocabulary.weekLine.
  const chats = useMyChats().data ?? null;
  // The owner's own photos, NOT business_detail's, which is filtered to
  // approved. This is the second half of biz-photo-grid-in-place and it is
  // the half that bites hardest: with require_photo_moderation on (which is
  // how production runs) an owner adds their cover, sees it chipped "In
  // review" one tap away in the editor, comes back here and is told to add
  // photos. This batch made that worse before it made it better - the row
  // now reads "Add photos so you have a cover" and the new counter scores it
  // 0, so the screen states the lie twice and quantifies it.
  const ownPhotos = useBusinessPhotos(business?.id ?? null).data ?? null;
  // Whether the square is on screen. Off by default - it is the counter case,
  // not the common one, and a 200pt QR above 'Your account' on every open
  // would push the settings rows below the fold for everybody.
  const [qrOpen, setQrOpen] = useState(false);

  // One reading of the clock per data change rather than one per render, so
  // the Hours row cannot flip from open to closed mid-scroll.
  const hoursLine = useMemo(
    () => (detail ? openLine(detail.hours, new Date(), detail.lng) : null),
    [detail]
  );

  // Conversations a traveler opened with this business inside seven days.
  // Counted off the list this screen's own tab already holds, so it costs no
  // query: my_chats returns kind 'business' rows to an owner, one per
  // traveler who wrote in.
  //
  // Same shape as hoursLine above, and for the same two reasons: the clock is
  // read once per data change rather than once per render, and the counting
  // itself is a pure function in vocabulary.ts, so it can be tested without a
  // component and cannot drift with the render schedule.
  const chatsThisWeek = useMemo(() => countChatsSince(chats, new Date()), [chats]);

  useEffect(() => {
    analytics.capture('my_business_viewed');
  }, []);

  // The first moment a traveler can write in is the first moment a
  // notification is worth anything, and it is the only such moment a business
  // ever reaches: the primer's ask() is called from useSendHello and
  // useCreatePin, two things a business can never do. So a business account
  // was never asked for permission at all, and the inbound message a bar is
  // here for arrived nowhere but inside the app. Asked here, in a business's
  // own words, because the primer sheet asks in a traveler's.
  const askBusiness = usePushPrimer((s) => s.askBusiness);
  const acceptPush = usePushPrimer((s) => s.accept);
  const declinePush = usePushPrimer((s) => s.decline);
  const live = business != null && business.state === 'listed' && business.active;
  // Only while this tab is the one being looked at. The tabs mount together,
  // so without this the question could arrive over the map or over a chat,
  // which is the ambush the primer exists to avoid.
  const focused = useIsFocused();
  const asked = useRef(false);
  useEffect(() => {
    if (!focused || !live || asked.current) {
      return;
    }
    // Before the await, not after: two renders in the same tick would
    // otherwise both get past the store's own guard and ask twice.
    asked.current = true;
    askBusiness('listing-live').then((worth) => {
      if (!worth) {
        return;
      }
      Alert.alert(
        'Travelers can write to you now',
        'Turn notifications on and your phone tells you when one does. Nothing else.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => void declinePush() },
          { text: 'Notify me', onPress: () => void acceptPush() },
        ]
      );
    });
  }, [focused, live, askBusiness, acceptPush, declinePush]);

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        configError
        icon={{ ios: 'storefront', android: 'storefront', web: 'storefront' }}
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
  // What the OWNER has, for the rows and the counter below. `detail.photos`
  // is the public read and still owns the cover thumbnail at the top of this
  // screen, which is right: that image IS what a traveler sees.
  const photos = ownPhotos ?? detail?.photos ?? [];
  const links = detail?.links ?? [];
  const done = detailsDone({
    hasAddress: business.address != null,
    photos: photos.length,
    hasHours: hoursLine != null,
    hasDescription: business.description != null,
    links: links.length,
  });
  const dark = business.state !== 'listed' || !business.active;

  // The screen's biggest button is whatever this owner has to do next.
  // "Post something" sat here in every state, so a business that was not on
  // the map yet had a composer promising the map as its most permanent
  // action, while the one thing standing in the way was a quieter button
  // halfway up a scroll.
  const next =
    business.state === 'unconfirmed'
      ? {
          label: 'Confirm your email',
          hint: 'Confirm your business email',
          onPress: () => router.push('/business-email'),
        }
      : dark
        ? {
            label: 'Contact us',
            hint: 'Contact us about this listing',
            onPress: () => router.push('/contact'),
          }
        : {
            label: 'Post something',
            hint: `Post something at ${business.name}`,
            onPress: () => router.push('/business-post'),
          };

  return (
    <ThemedView style={styles.root}>
      <View style={styles.column}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: barHeight + Space.xl }]}
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
                  transition={Motion.standard}
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

            {/* What is standing between this business and the map, said and
                not repeated: the docked button below is the way to answer it,
                so a second copy of the same action here would only make both
                of them look optional.

                No claim that a code has just been sent, either. This screen
                is where an owner comes back days later, and it went on saying
                one was on its way long after the twenty minutes were up. */}
            {business.state === 'unconfirmed' ? (
              <View style={[styles.notice, { backgroundColor: theme.surface }]}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {codeBounced
                    ? 'That address bounced, so the code never arrived. Send it to another one and you are on the map.'
                    : codeRunOut
                      ? 'The code we sent has run out. Send yourself a fresh one and you are on the map.'
                      : "Travelers can't find you until you confirm your business email."}
                </ThemedText>
              </View>
            ) : dark ? (
              <View style={[styles.notice, { backgroundColor: theme.surface }]}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {business.state === 'flagged'
                    ? "We're taking a look at this listing."
                    : 'This listing is off the map. Write to us and we will tell you why.'}
                </ThemedText>
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
              // Shapes, not empty states. Every row below falls back to its
              // "add this" line before its query lands, and telling a
              // business to add hours it already has while we are still
              // asking is the same lie LoadError exists to stop.
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
                    <>
                      {/* The first of the two numbers this screen already
                          holds and never said: how much of yours is live on
                          the listing right now. */}
                      <ThemedText type="footnote" themeColor="textSecondary">
                        {countOf(posts.length, 'post')} live on your listing
                      </ThemedText>
                      {posts.map((post) => (
                        <PostCard
                          key={post.id}
                          post={post}
                          onTakeDown={() => {
                            archivePost.mutate(post.id);
                          }}
                          onFix={() =>
                            router.push({
                              pathname: '/business-post',
                              params: { postId: post.id },
                            })
                          }
                          // `again: '1'` copies the words onto a NEW row with
                          // a date the owner has to look at, rather than
                          // clearing archived_at - un-archiving by hand would
                          // put last week's date back on the map.
                          onAgain={() =>
                            router.push({
                              pathname: '/business-post',
                              params: { postId: post.id, again: '1' },
                            })
                          }
                        />
                      ))}
                    </>
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
                  {/* Somewhere to get to. Five rows with no total is a list
                      that never ends; '3 of 5 done' is the same five rows
                      with a finish line on them. */}
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {`${done} of 5 done`}
                  </ThemedText>
                  {/* A business that moved premises had a listing on the wrong
                      door forever: this screen covered hours, links, words and
                      photos and had no way to the address, the city or the
                      marker, though the editor has held all three since
                      business-edit's location section, and
                      update_business_location is granted to the owner. */}
                  <DetailRow
                    label="Where you are"
                    section="location"
                    icon={{
                      ios: 'mappin.and.ellipse',
                      android: 'location_on',
                      web: 'location_on',
                    }}
                    value={business.address ?? 'No address yet'}
                  />
                  {/* Ordered by what each one does to the listing on the
                      map, not by the order the columns happen to sit in:
                      photos are the cover a traveler decides on, hours are
                      the question they opened the page to answer, and links
                      are the last of the five. 'Where you are' stays first
                      because a listing on the wrong door is not a listing.

                      And every empty value says what filling it BUYS. Four
                      rows reading 'Nothing yet' is a column of the same
                      shrug, and it tells an owner who has just signed up
                      that this screen is a list of their failures. */}
                  <DetailRow
                    label="Photos"
                    section="photos"
                    icon={{
                      ios: 'photo.on.rectangle',
                      android: 'photo_library',
                      web: 'photo_library',
                    }}
                    value={
                      photos.length > 0
                        ? countOf(photos.length, 'photo')
                        : 'Add photos so you have a cover'
                    }
                  />
                  <DetailRow
                    label="Hours"
                    section="hours"
                    icon={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                    value={hoursLine ?? 'Add hours so travelers know when to come'}
                  />
                  <DetailRow
                    label="Description"
                    // 'details', not 'description': business-edit's Section
                    // union has no such member, and measure() compares by
                    // equality, so the editor opened at the top instead of
                    // scrolling to the field the row named.
                    section="details"
                    icon={{ ios: 'text.alignleft', android: 'notes', web: 'notes' }}
                    value={business.description ?? 'Say what it is like'}
                  />
                  <DetailRow
                    label="Links"
                    section="links"
                    icon={{ ios: 'link', android: 'link', web: 'link' }}
                    value={
                      links.length > 0
                        ? countOf(links.length, 'link')
                        : 'A menu, a booking page, your socials'
                    }
                  />
                </Section>

                {/* The way into their own room. It appears in the Chat tab
                    too, but this is the screen an owner opens, and nothing
                    here pointed at the one place travelers gather. */}
                {business.chat_id ? (
                  <Section
                    title="Your chat"
                    icon={{ ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' }}>
                    {/* The second number, promoted to the row's own headline:
                        membership is the closest thing to an audience figure
                        this screen honestly has. Worded as membership, never
                        as reach — member_count is who joined the chat, not
                        who saw the listing, and an owner reading it as views
                        would be being lied to. */}
                    <DetailRow
                      label={
                        detail && detail.member_count > 0
                          ? `${countOf(detail.member_count, 'traveler')} in your chat`
                          : 'Nobody in yet'
                      }
                      icon={{ ios: 'bubble.left', android: 'chat', web: 'chat' }}
                      value="Open your chat"
                      onPress={() => router.push(`/room/${business.chat_id}`)}
                    />
                  </Section>
                ) : null}

                {/* The only section on this screen that is not the owner's
                    own typing read back to them. One sentence, from numbers
                    the screen already holds - see vocabulary.weekLine for
                    why it is a sentence and not a dashboard, and why it
                    counts conversations rather than people. */}
                <Section
                  title="How it's going"
                  icon={{
                    ios: 'chart.line.uptrend.xyaxis',
                    android: 'trending_up',
                    web: 'trending_up',
                  }}>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {weekLine({ chatsThisWeek, memberCount: detail?.member_count ?? 0 })}
                  </ThemedText>
                </Section>

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

                {/* The map was the only route to a business page, so a
                    hostel that wanted "we're on Samewhere" behind reception
                    had nothing to point at. The square is the counter case
                    and is closed by default; the share sheet is the one for
                    a booking confirmation or an Instagram bio. */}
                <Section
                  title="Share your page"
                  icon={{
                    ios: 'square.and.arrow.up',
                    android: 'ios_share',
                    web: 'ios_share',
                  }}>
                  <DetailRow
                    label={LISTING_SHARE_LABEL}
                    icon={{
                      ios: 'square.and.arrow.up',
                      android: 'ios_share',
                      web: 'ios_share',
                    }}
                    value="Send the link to your page"
                    onPress={() => {
                      void shareListing({ id: business.id, name: business.name });
                    }}
                  />
                  <DetailRow
                    label="Show a QR code"
                    icon={{ ios: 'qrcode', android: 'qr_code', web: 'qr_code' }}
                    value={qrOpen ? 'Hide the square' : 'For the counter'}
                    onPress={() => setQrOpen((open) => !open)}
                  />
                  {qrOpen ? (
                    <ShareLink
                      url={listingUrl(business.id)}
                      message={listingShareMessage({ id: business.id, name: business.name })}
                      caption={LISTING_QR_CAPTION}
                      shareLabel={LISTING_SHARE_LABEL}
                    />
                  ) : null}
                </Section>

                {/* The account controls, from the tab the account page sends
                    every owner to. They were reachable only by leaving this
                    tab for another one and tapping a person icon, which is a
                    thing nobody would guess and the icon of a traveler. */}
                <Section
                  title="Your account"
                  icon={{ ios: 'gearshape', android: 'settings', web: 'settings' }}>
                  <DetailRow
                    label="House rules and account"
                    icon={{
                      ios: 'person.crop.circle',
                      android: 'account_circle',
                      web: 'account_circle',
                    }}
                    value="Sign out, delete, how this works"
                    onPress={() => router.push('/profile-me')}
                  />
                  {pushState != null ? (
                    <DetailRow
                      label="Notifications"
                      icon={{
                        ios: 'bell.badge',
                        android: 'notifications',
                        web: 'notifications',
                      }}
                      value={notificationValueLine(pushState)}
                      // The same three-state action as the account pages:
                      // never been asked goes straight to the OS dialog
                      // (Settings has no Samewhere entry yet), a denial goes
                      // to Settings, and On passes NO handler at all, so the
                      // row renders inert instead of swallowing the tap.
                      onPress={
                        pushState === 'granted'
                          ? undefined
                          : pushState === 'undetermined'
                            ? enablePush
                            : () => {
                                Linking.openSettings().catch(() => {});
                              }
                      }
                    />
                  ) : null}
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
            thing a business opens the tab to do. DockedActionBar is the same
            chrome Travelers docks: an opaque plate exactly as tall as the
            measured bar, a short ramp fading down to it, and hit-testing
            that lets taps through — the single gradient it replaces reached
            full opacity 55% of the way down its own height, so the button
            row sat on a half-transparent wash and the page read through. */}
        <DockedActionBar
          primaryLabel={next.label}
          primaryAccessibilityLabel={next.hint}
          onPrimary={next.onPress}
          bottomInset={dockBottom}
          onBarHeight={setBarHeight}
        />
      </View>
    </ThemedView>
  );
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
});
