import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { LoadError } from '@/components/ui/load-error';
import { Sheet, leavingSheet } from '@/components/ui/sheet';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { Skeleton } from '@/components/ui/skeleton';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { BUSINESS_PHOTO_BUCKET } from '@/features/business/api';
import { PlaceGlyph } from '@/features/business/business-marker';
import { useBusinessDetail, useRatingSummary } from '@/features/business/hooks';
import { CATEGORY_LABEL, openLine, weekdayLabel } from '@/features/business/vocabulary';
import { useIsGuest } from '@/features/guest/hooks';
import { useMyChats } from '@/features/matching/hooks';
import { openInMaps } from '@/features/pins/open-in-maps';
import { useTheme } from '@/hooks/use-theme';
import type { BusinessPostJson } from '@/lib/database.types';
import { countOf } from '@/lib/plural';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

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
  const detail = useBusinessDetail(businessId);
  const rating = useRatingSummary(businessId);
  const place = detail.data ?? null;
  const { data: chats = [] } = useMyChats();
  const cover = usePlacePhotoUrl(place?.photos[0]?.storage_path ?? null);

  // Every push from inside a sheet dismisses it first. The scrim outliving
  // the push is what left the map dead to touch. See components/ui/sheet.
  const leaveThen = leavingSheet(onClose);

  // One reading of the clock per data change rather than one per render, so
  // a re-render cannot flip "Open" to "Closed" halfway through a sentence,
  // and the post and its when-label cannot disagree about what time it is.
  const open = useMemo(() => (place ? openLine(place.hours, new Date()) : null), [place]);
  const whatsOn = useMemo(() => {
    if (!place) {
      return null;
    }
    const now = new Date();
    const post = currentPost(place.posts, now);
    return post ? { post, when: whenLabel(post, now) } : null;
  }, [place]);

  if (detail.isPending) {
    // Two lines of skeleton, not a hero-sized block: the sheet is small and
    // the note in components/ui/skeleton is about shimmering over a BASEMAP,
    // which this is not - it sits on the sheet's own surface.
    return (
      <View style={styles.card}>
        <Skeleton width="65%" height={18} radius={Radius.sm} />
        <Skeleton width="40%" height={13} radius={Radius.sm} />
      </View>
    );
  }

  if (detail.isError) {
    return (
      <View style={styles.card}>
        <LoadError
          what="this place"
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
  const address = place.place_label?.trim() || null;

  return (
    <View style={styles.card}>
      {cover.data ? (
        <Image
          source={{ uri: cover.data }}
          style={styles.cover}
          contentFit="cover"
          transition={200}
        />
      ) : null}

      <View style={styles.header}>
        {/* The same chip and glyph as the marker just tapped, so the sheet
            reads as that marker opening rather than as a new object. A cover
            photo says it better, so it only stands in when there is none. */}
        {cover.data ? null : <PlaceGlyph category={place.category} live={whatsOn != null} />}
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
            hitSlop={8}
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
      ) : null}

      {isGuest ? (
        <SignUpGate
          reason="Join the chat here, or message the place"
          where="place-sheet"
          compact
          onNavigate={leaveThen}
        />
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
          {/* Second on every surface, and always available: a place with no
              chat yet is still somewhere you can write to. */}
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
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="See the whole page"
        hitSlop={10}
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
    </View>
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
 * The check beside a place's name.
 *
 * Its own control rather than `VerifiedSeal`, which explains a live SELFIE
 * checked against a profile: true of a traveler, false of a bar, and a badge
 * that explains itself wrongly is worse than one that says nothing. The
 * spoken label is "Verified place" and never "verified business", because
 * that word is back-office vocabulary a traveler never meets.
 */
function PlaceSeal() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Verified place"
      accessibilityHint="What the verified check means"
      hitSlop={Math.ceil((HitTarget - SEAL) / 2)}
      onPress={() =>
        Alert.alert(
          'Verified place',
          'Somebody stood outside and sent us live photos of the front, and we checked the sign against this listing.'
        )
      }>
      <SymbolView
        name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
        size={SEAL}
        tintColor={theme.accent}
      />
    </Pressable>
  );
}

const SEAL = 14;

/**
 * The cover, signed.
 *
 * Its own query rather than `usePhotoUrl`, which is bound to the profile
 * bucket. Places live in their own private bucket, and a signed-out visitor
 * cannot sign anything there at all, so a missing URL is an ordinary outcome
 * and the sheet has to read without one.
 */
function usePlacePhotoUrl(storagePath: string | null) {
  return useQuery({
    queryKey: ['place-photo-url', storagePath],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(BUSINESS_PHOTO_BUCKET)
        .createSignedUrl(storagePath!, SIGNED_URL_TTL_SECONDS);
      if (error) {
        throw error;
      }
      return data.signedUrl;
    },
    enabled: isSupabaseConfigured && storagePath != null,
    // Both under the hour the URL is good for, so a cached one cannot be
    // handed out after it has expired.
    staleTime: 50 * 60 * 1000,
    gcTime: 55 * 60 * 1000,
  });
}

const SIGNED_URL_TTL_SECONDS = 60 * 60;

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
    gap: 1,
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
    paddingTop: 2,
  },
  post: {
    gap: 2,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Space.xs,
  },
  actions: {
    gap: Space.sm,
  },
  pageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
  },
});
