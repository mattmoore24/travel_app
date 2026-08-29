import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { LoadError } from '@/components/ui/load-error';
import { Sheet, leavingSheet } from '@/components/ui/sheet';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { Skeleton } from '@/components/ui/skeleton';
import { HitTarget, Motion, Radius, Space } from '@/constants/theme';
import { PlaceGlyph } from '@/features/business/business-marker';
import { PlaceSeal } from '@/features/business/place-seal';
import { useBusinessDetail, useOwnBusiness, useRatingSummary } from '@/features/business/hooks';
import { CATEGORY_LABEL, openLine, weekdayLabel } from '@/features/business/vocabulary';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { useIsGuest } from '@/features/guest/hooks';
import { useMyChats } from '@/features/matching/hooks';
import { openInMaps } from '@/features/pins/open-in-maps';
import { useTheme } from '@/hooks/use-theme';
import type { BusinessPostJson } from '@/lib/database.types';
import { countOf } from '@/lib/plural';

/**
 * A place, opened.
 *
 * The same sheet as a pin card, deliberately: `inline` and undimmed, so the
 * map stays live underneath and tapping another marker swaps this card for
 * that one instead of making you dismiss it first. Two sheet idioms in one
 * app is a bug, and the inline form is also the answer to the presentation
 * iOS drops — there is no `<Modal>` here to lose, and none to render under a
 * keyboard that is still up.
 */
export function PlaceSheet({
  businessId,
  onClose,
}: {
  businessId: string | null;
  onClose: () => void;
}) {
  if (businessId == null) {
    return null;
  }
  // Keyed on the id so switching places tears the card down rather than
  // re-using one holding the last place's photo.
  return (
    <Sheet inline dimmed={false} onClose={onClose}>
      <PlaceCard key={businessId} businessId={businessId} onClose={onClose} />
    </Sheet>
  );
}

function PlaceCard({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const theme = useTheme();
  const isGuest = useIsGuest();
  // Which kind of account is reading this card. A business is neither a
  // guest nor a traveler, and until now it was served the traveler's card:
  // "Join the chat" and "Message" on every rival's marker, and on its own.
  // Both are refused by the database (assert_not_business, 20260829190000),
  // so the founder's "under no circumstances" was a pair of buttons that
  // failed after the tap.
  const ownBusiness = useOwnBusiness().data ?? null;
  const viewerIsBusiness = ownBusiness != null;
  const detail = useBusinessDetail(businessId);
  const rating = useRatingSummary(businessId);
  const place = detail.data ?? null;
  const { data: chats = [] } = useMyChats();
  const cover = useBusinessPhotoUrl(place?.photos[0]?.storage_path ?? null);

  // Every push from inside a sheet dismisses it first. The scrim outliving
  // the push is what left the map dead to touch. See components/ui/sheet.
  const leaveThen = leavingSheet(onClose);

  // One reading of the clock per data change rather than one per render, so
  // a re-render cannot flip "Open" to "Closed" halfway through a sentence,
  // and the post and its when-label cannot disagree about what time it is.
  const open = useMemo(
    () => (place ? openLine(place.hours, new Date(), place.lng) : null),
    [place]
  );
  const whatsOn = useMemo(() => {
    if (!place) {
      return null;
    }
    const now = new Date();
    const post = currentPost(place.posts, now);
    return post ? { post, when: whenLabel(post, now) } : null;
  }, [place]);

  if (detail.isPending) {
    // Shaped like the card it becomes — name, meta line, one button — rather
    // than two stray lines. The sheet is sized by whatever is inside it, so a
    // skeleton much shorter than the answer makes the card leap when the
    // answer lands. No hero block: we do not yet know whether this place has a
    // photo, and reserving one for a place without one is a worse lie than the
    // jump. The note in components/ui/skeleton is about shimmering over a
    // BASEMAP, which this is not - it sits on the sheet's own surface.
    return (
      <View style={styles.card}>
        <Skeleton width="65%" height={18} radius={Radius.sm} />
        <Skeleton width="40%" height={13} radius={Radius.sm} />
        <Skeleton width="100%" height={HitTarget} radius={Radius.md} />
      </View>
    );
  }

  if (detail.isError) {
    return (
      <View style={styles.card}>
        <LoadError
          what="this business"
          error={detail.error}
          onRetry={() => detail.refetch()}
          compact
        />
      </View>
    );
  }

  if (!place) {
    // The listing went dark between the map being drawn and this tap. Say so
    // rather than showing an empty card somebody will keep tapping.
    return (
      <View style={styles.card}>
        <ThemedText type="body">This one isn&apos;t on the map any more.</ThemedText>
        <PrimaryButton label="Done" onPress={onClose} />
      </View>
    );
  }

  const inTheChat = place.chat_id != null && chats.some((chat) => chat.chat_id === place.chat_id);
  // The owner tapped their own chip. The founder tested exactly this and was
  // offered "Join the chat" at their own business.
  const isMine = ownBusiness != null && ownBusiness.id === place.id;
  const address = place.place_label?.trim() || null;
  // Whether there IS a cover, which the listing already told us, as opposed to
  // whether its signed URL has come back yet. The two are a round trip apart,
  // and treating the second as the first is what made the card grow a photo's
  // worth of height a beat after it opened.
  // ...and whether it is still on its way, as opposed to never arriving. A
  // signing call that FAILS must give the space back rather than shimmer
  // forever, which is a worse card than the one without a photo.
  const coverComing = place.photos[0]?.storage_path != null && !cover.isError;

  return (
    // A ScrollView, not a View. Everything this card can hold at once —
    // cover, name, address, Maps link, tonight's post, the score, two
    // buttons and the page link — adds up to more than the sheet's own
    // ceiling (screen height minus the top inset) on a small phone, and at
    // large Dynamic Type on any phone. Overflowing a sheet does not scroll
    // by itself: the Message button is simply below the edge with nothing to
    // pull. `flexShrink` is what lets the sheet's maxHeight bound it.
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.card}
      showsVerticalScrollIndicator={false}>
      {cover.data ? (
        <Image
          source={{ uri: cover.data }}
          style={styles.cover}
          contentFit="cover"
          transition={Motion.standard}
          accessibilityLabel={`Photo of ${place.name}`}
        />
      ) : coverComing ? (
        <Skeleton width="100%" aspectRatio={3 / 2} radius={Radius.lg} />
      ) : null}

      <View style={styles.header}>
        {/* The same chip and glyph as the marker just tapped, so the sheet
            reads as that marker opening rather than as a new object. A cover
            photo says it better, so it only stands in when there is none. */}
        {coverComing ? null : (
          <PlaceGlyph
            category={place.category}
            live={whatsOn != null}
            size={30}
            onSurface
            own={isMine}
          />
        )}
        <View style={styles.title}>
          <View style={styles.nameRow}>
            <ThemedText type="headline" numberOfLines={2} style={styles.name}>
              {place.name}
            </ThemedText>
            {place.verified ? <PlaceSeal /> : null}
          </View>
          <ThemedText type="footnote" themeColor="textSecondary">
            {[CATEGORY_LABEL[place.category], open].filter(Boolean).join(' · ')}
          </ThemedText>
          {address ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
              {address}
            </ThemedText>
          ) : null}
          {/* Getting there is somebody else's job, and the phone already has
              an app for it. */}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`View ${place.name} in Maps`}
            // 18pt row: 13 a side is the 44 every small control here buys.
            hitSlop={13}
            onPress={() =>
              openInMaps({ lat: place.lat, lng: place.lng, label: address ?? place.name })
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
          // 11, not 8: 22pt of glyph plus 11 a side is the 44 every small
          // control in this app buys itself.
          hitSlop={11}>
          <SymbolView
            name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
            size={22}
            tintColor={theme.textSecondary}
          />
        </Pressable>
      </View>

      {whatsOn ? (
        <View style={styles.post}>
          <ThemedText type="caption" style={{ color: theme.highlight }}>
            {whatsOn.when}
          </ThemedText>
          <ThemedText type="callout" numberOfLines={2}>
            {whatsOn.post.title}
          </ThemedText>
          {whatsOn.post.body ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
              {whatsOn.post.body}
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {/* Held back until the answer is in. "Not rated yet" flashed for a
          beat and then became an 8.4, which is the app contradicting itself
          on the one number a place is judged by. */}
      {rating.isSuccess ? (
        <RatingLine average={rating.data?.average ?? null} raters={rating.data?.rater_count ?? 0} />
      ) : (
        <Skeleton width="35%" height={17} radius={Radius.sm} />
      )}

      {isGuest ? (
        <SignUpGate
          reason="Join the chat here, or message the business"
          where="place-sheet"
          compact
          onNavigate={leaveThen}
        />
      ) : viewerIsBusiness ? (
        // A business reads this map to see the city it is in. It never joins
        // a chat and never writes first, so there is no control here to hide
        // and nothing to refuse: the card says what the business is and
        // stops. See docs/BUSINESS_ACCOUNTS.md rule 8.
        <View style={styles.actions}>
          {isMine ? (
            <>
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.viewerNote}>
                Your business, the way travelers see it.
              </ThemedText>
              <PrimaryButton
                label="Open My business"
                accessibilityLabel="Open My business"
                onPress={() => leaveThen(() => router.navigate('/my-business'))}
              />
            </>
          ) : (
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.viewerNote}>
              Another business on your map. Travelers are the ones who join and message.
            </ThemedText>
          )}
        </View>
      ) : (
        <View style={styles.actions}>
          {place.chat_id ? (
            <PrimaryButton
              label={inTheChat ? 'Open the chat' : 'Join the chat'}
              accessibilityLabel={
                inTheChat ? `Open the chat at ${place.name}` : `Join the chat at ${place.name}`
              }
              onPress={() =>
                leaveThen(() =>
                  inTheChat
                    ? router.push({ pathname: '/room/[id]', params: { id: place.chat_id! } })
                    : router.push({
                        pathname: '/join-place',
                        params: { businessId: place.id, chatId: place.chat_id!, name: place.name },
                      })
                )
              }
            />
          ) : null}
          {/* Second on every surface. Offered only where somebody is
              actually on the other end: `message_business` refuses an
              unclaimed venue outright, and it does it AFTER five hundred
              characters have been typed and Send has been pressed. The
              launch venues are all unclaimed on day one, so this is the
              first tap somebody makes. */}
          {place.claimed ? (
            <PrimaryButton
              label="Message"
              variant={place.chat_id ? 'tonal' : 'filled'}
              accessibilityLabel={`Message ${place.name}`}
              onPress={() =>
                leaveThen(() =>
                  router.push({
                    pathname: '/message-place',
                    params: { businessId: place.id, name: place.name },
                  })
                )
              }
            />
          ) : (
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.unclaimed}>
              Nobody runs this business on Samewhere yet. The chat is open to anyone passing
              through.
            </ThemedText>
          )}
        </View>
      )}

      {/* The whole page is the TRAVELER's page: joining, messaging and rating,
          none of which a business may do. The owner reads their own listing
          from the My business tab, which is the button above. */}
      {viewerIsBusiness ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See the whole page"
          // 18pt row plus 13 either side is 44. The close button next to it
          // computes the same number a different way; both have to clear it.
          hitSlop={13}
          onPress={() =>
            leaveThen(() => router.push({ pathname: '/place/[id]', params: { id: place.id } }))
          }
          style={styles.pageLink}>
          <ThemedText type="footnote" themeColor="accent">
            See the whole page
          </ThemedText>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={12}
            tintColor={theme.accent}
          />
        </Pressable>
      )}
    </ScrollView>
  );
}

/**
 * The public number, or the honest absence of one.
 *
 * The server returns nulls below five raters rather than trusting a client to
 * hide a 9.2 from one person, so there is nothing to threshold here.
 */
function RatingLine({ average, raters }: { average: number | null; raters: number }) {
  if (average == null) {
    return (
      <ThemedText type="footnote" themeColor="textSecondary">
        Not rated yet
      </ThemedText>
    );
  }
  const score = average.toFixed(1);
  return (
    <View
      accessible
      accessibilityLabel={`Rated ${score} out of 10 by ${countOf(raters, 'traveler')}`}
      style={styles.rating}>
      <ThemedText type="callout" style={styles.score}>
        {score}
      </ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        · {countOf(raters, 'traveler')}
      </ThemedText>
    </View>
  );
}

/**
 * What is on, if anything: the first post that has not finished yet.
 *
 * `business_detail` already drops what the place archived and orders by start
 * time with the undated standing notices last, so the first survivor is the
 * one a traveler would ask about.
 */
function currentPost(posts: BusinessPostJson[], now: Date): BusinessPostJson | null {
  return posts.find((p) => p.ends_at == null || new Date(p.ends_at) > now) ?? null;
}

/**
 * When it is, in the words somebody would use out loud.
 *
 * Never "Tonight" for a thing happening on Thursday, and never at all for a
 * standing notice with no time on it. This line is the place's promise, and a
 * wrong one sends somebody across a city.
 */
function whenLabel(post: BusinessPostJson, now: Date): string {
  if (post.happens_at == null) {
    return "What's on";
  }
  const at = new Date(post.happens_at);
  if (at <= now) {
    return 'On now';
  }
  const days = calendarDaysApart(now, at);
  if (days === 0) {
    return at.getHours() >= 17 ? 'Tonight' : 'Later today';
  }
  if (days === 1) {
    return 'Tomorrow';
  }
  return weekdayLabel(at.getDay());
}

/** Whole days between two local midnights, so a DST night still counts as one. */
function calendarDaysApart(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

const styles = StyleSheet.create({
  scroll: {
    flexShrink: 1,
  },
  card: {
    gap: Space.md,
  },
  cover: {
    width: '100%',
    aspectRatio: 3 / 2,
    borderRadius: Radius.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  title: {
    flex: 1,
    gap: Space.xs / 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  name: {
    flexShrink: 1,
  },
  score: {
    fontWeight: '600',
  },
  mapsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingTop: Space.xs / 2,
  },
  post: {
    gap: Space.xs / 2,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Space.xs,
  },
  actions: {
    gap: Space.sm,
  },
  unclaimed: {
    textAlign: 'center',
  },
  viewerNote: {
    textAlign: 'center',
  },
  pageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
  },
});
