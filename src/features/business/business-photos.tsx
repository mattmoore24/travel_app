import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { LoadError } from '@/components/ui/load-error';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet, leavingSheet } from '@/components/ui/sheet';
import { photoRejection } from '@/constants/moderation';
import { Radius, Space } from '@/constants/theme';
import { BUSINESS_PHOTO_BUCKET } from '@/features/business/api';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { useTheme } from '@/hooks/use-theme';
import type { Database } from '@/lib/database.types';
import { haptics } from '@/lib/haptics';
import { processAndUploadImage, removeUploadedImage } from '@/lib/image-upload';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * The photo grid, in one place, because two screens need the same one.
 *
 * It used to live inside business-edit.tsx and signup's photo step routed to
 * that editor to reach it — which meant step 7 was a headline, three lines of
 * subtitle and roughly a thousand points of black, and an owner who tapped
 * "Add photos" landed in the middle of a 1,430-line settings form. One grid
 * and one save model, rather than a second copy living inside signup.
 */

type PhotoRow = Database['public']['Tables']['business_photos']['Row'];

/** The database's own ceiling; this only keeps the UI honest about it. */
export const PHOTOS_MAX = 10;

const PHOTO_COLUMNS = 3;
const PHOTO_GAP = Space.sm;

// -- Round trips ---------------------------------------------------------------
//
// A straight table read rather than business_detail(): that RPC answers for a
// business a TRAVELER can see, so it filters to `moderation_status =
// 'approved'` and returns nothing at all while the listing is unconfirmed.
// Both of those are exactly the cases the owner's own grid is FOR. The
// business_photos_select_own policy is what makes this read owner-scoped, and
// it is the only safe door: widening business_detail would tell any traveler
// that a non-approved photo exists.

async function fetchBusinessPhotos(businessId: string) {
  const { data, error } = await supabase
    .from('business_photos')
    .select('*')
    .eq('business_id', businessId)
    .order('position')
    .order('created_at');
  if (error) {
    throw error;
  }
  return (data ?? []) as PhotoRow[];
}

/** Upload, then register the row, which is what opens the moderation check. */
async function uploadBusinessPhoto(input: {
  businessId: string;
  userId: string;
  localUri: string;
  position: number;
}) {
  const storagePath = await processAndUploadImage(
    BUSINESS_PHOTO_BUCKET,
    input.userId,
    input.localUri
  );
  const { error } = await supabase.from('business_photos').insert({
    business_id: input.businessId,
    storage_path: storagePath,
    position: input.position,
  });
  if (error) {
    await removeUploadedImage(BUSINESS_PHOTO_BUCKET, storagePath);
    throw error;
  }
}

async function deleteBusinessPhoto(photo: PhotoRow) {
  const { error } = await supabase.from('business_photos').delete().eq('id', photo.id);
  if (error) {
    throw error;
  }
  // storage-js reports failures in the result rather than by throwing. An
  // orphan is invisible to everyone (reads resolve through the photo row),
  // so log it rather than failing a delete that has already happened.
  const { error: removeError } = await supabase.storage
    .from(BUSINESS_PHOTO_BUCKET)
    .remove([photo.storage_path]);
  if (removeError) {
    console.warn(`orphaned storage object ${photo.storage_path}: ${removeError.message}`);
  }
}

/**
 * The owner's own photos, moderation state and all.
 *
 * Exported because signup's photo step gates its Continue on this list rather
 * than on `detail?.photos`: business_detail is approved-only, so with
 * require_photo_moderation ON — which is how production runs — an owner added
 * their cover, watched it chip "In review", and was told "One photo is the
 * only thing we need here" by a step that could not see it.
 */
export function useBusinessPhotos(businessId: string | null) {
  return useQuery({
    queryKey: ['business-photos', businessId],
    queryFn: () => fetchBusinessPhotos(businessId!),
    enabled: isSupabaseConfigured && businessId != null,
    // A verdict lands in the database, not in this app, and this is the
    // screen most likely to be open while it does: somebody has just added a
    // photo and is watching the tile that says "In review". Without a watch
    // it says that until the screen is left and come back to, and a rejected
    // photo never gets to explain itself at all - which is the whole point of
    // the chip beside it.
    //
    // A poll rather than a realtime subscription: it needs no channel, no
    // teardown and no policy, and it STOPS on its own. The moment every photo
    // has settled the interval returns false, so an owner reading their own
    // finished listing is not paying for a socket. Ten seconds is the
    // moderation worker's own order of magnitude; a person watching a
    // spinner will not count it.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((photo) => photo.moderation_status !== 'approved')
        ? 10_000
        : false,
  });
}

/**
 * Which photo the public sees as the cover, or null while nobody sees one.
 *
 * Every reader outside this screen takes `order by position limit 1` from a
 * view that has already filtered to approved, so the cover is the first
 * APPROVED photo and not the first row. The editor compared against
 * `photos[0]` and so labelled a pending photo "Cover" and asked "Remove your
 * cover photo?" about something no traveler could see.
 *
 * Pure, and separately tested, because the whole bug was one index.
 */
export function coverIdOf(
  photos: readonly Pick<PhotoRow, 'id' | 'moderation_status'>[]
): string | null {
  return photos.find((photo) => photo.moderation_status === 'approved')?.id ?? null;
}

// -- The grid ------------------------------------------------------------------

function PhotoTile({
  photo,
  size,
  cover,
  onRemove,
}: {
  photo: PhotoRow;
  size: number;
  cover: boolean;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const { data: url } = useBusinessPhotoUrl(photo.storage_path);
  const rejected = photo.moderation_status === 'rejected';
  // Same two-state treatment the profile grid got, from the same copy: a
  // check that gave up is 'Try again' on warning and is explicitly not a
  // rules breach, a real rejection is 'Removed' on danger and names the
  // category. "Didn't pass" said neither, so an owner could only guess.
  const why = photoRejection(photo.moderation_category, photo.moderation_engine);
  const [explaining, setExplaining] = useState(false);
  const closeWhy = () => setExplaining(false);
  // Navigating out from under a presented Sheet strands its scrim over the
  // screen. Dismiss first, push after.
  const leaveWhy = leavingSheet(closeWhy);

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(150)}
      layout={LinearTransition.springify()}
      style={[styles.tile, { width: size, height: size, backgroundColor: theme.surfaceSunken }]}>
      {url ? <Image source={{ uri: url }} style={styles.fill} contentFit="cover" /> : null}
      {rejected ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={
            why.failsafe
              ? 'This photo could not be checked. Tap to find out what to do.'
              : 'This photo was removed. Tap to find out why.'
          }
          haptic="light"
          scaleTo={0.94}
          hitSlop={10}
          onPress={() => setExplaining(true)}
          containerStyle={styles.tileChipAnchor}
          style={[
            styles.tileChip,
            { backgroundColor: why.failsafe ? theme.warning : theme.danger },
          ]}>
          <ThemedText type="caption" style={{ color: theme.onHighlight }}>
            {why.chip}
          </ThemedText>
        </PressableScale>
      ) : photo.moderation_status !== 'approved' ? (
        <View style={[styles.tileChipAnchor, styles.tileChip, { backgroundColor: theme.surface }]}>
          <ThemedText type="caption">In review</ThemedText>
        </View>
      ) : cover ? (
        <View style={[styles.tileChipAnchor, styles.tileChip, { backgroundColor: theme.surface }]}>
          <ThemedText type="caption">Cover</ThemedText>
        </View>
      ) : null}
      {explaining ? (
        <Sheet onClose={closeWhy}>
          <View style={styles.whyBody}>
            <ThemedText type="title">{why.title}</ThemedText>
            <ThemedText type="body" themeColor="textSecondary">
              {why.body}
            </ThemedText>
          </View>
          <View style={styles.whyActions}>
            {why.failsafe ? null : (
              <PrimaryButton
                variant="ghost"
                label="Contact us"
                accessibilityLabel="Contact us about this photo"
                onPress={() => leaveWhy(() => router.push('/contact'))}
              />
            )}
            <PrimaryButton label="Done" accessibilityLabel="Done" onPress={closeWhy} />
          </View>
        </Sheet>
      ) : null}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={cover ? 'Remove the cover photo' : `Remove photo ${photo.position + 1}`}
        haptic="light"
        scaleTo={0.88}
        // 10 + 24 + 10 = 44. hitSlop is honoured by the Pressable itself, so
        // the tile's overflow: hidden cannot clip the target.
        hitSlop={10}
        onPress={onRemove}
        containerStyle={styles.removeAnchor}
        style={[styles.removeDot, { backgroundColor: theme.surface }]}>
        <SymbolView
          name={{ ios: 'xmark', android: 'close', web: 'close' }}
          size={11}
          tintColor={theme.text}
        />
      </PressableScale>
    </Animated.View>
  );
}

export function BusinessPhotos({
  businessId,
  userId,
  registerPick,
  onCommitted,
}: {
  businessId: string;
  userId: string | null;
  /**
   * Hands the picker up to a parent that draws its own button for it.
   *
   * Signup's photo step docks "Add photos" at the bottom of StepShell, and
   * run 87 photographed the alternative: two identical "Add photos" buttons
   * adrift on one screen. One picker, driven from both the dashed tile and
   * the docked button, is the only shape that cannot become that pair again.
   */
  registerPick?: (pick: () => void) => void;
  /**
   * Fired after an upload or a delete has actually landed.
   *
   * Photos commit the moment they are tapped while the rest of the editor is
   * held until Save, so business-edit's discard guard needs to know that
   * SOMETHING is already saved before it offers to throw the session away.
   */
  onCommitted?: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const photosQuery = useBusinessPhotos(businessId);
  const { data: photos = [] } = photosQuery;
  const [width, setWidth] = useState(0);

  const upload = useMutation({
    mutationFn: (input: { localUri: string; position: number }) =>
      uploadBusinessPhoto({ businessId, userId: userId!, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-photos', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      onCommitted?.();
    },
  });
  const remove = useMutation({
    mutationFn: deleteBusinessPhoto,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-photos', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      onCommitted?.();
    },
  });

  const size =
    width > 0 ? Math.floor((width - PHOTO_GAP * (PHOTO_COLUMNS - 1)) / PHOTO_COLUMNS) : 0;
  const full = photos.length >= PHOTOS_MAX;

  /** Lowest free slot, so a delete leaves a hole the next upload fills. */
  const nextPosition = () => {
    const taken = new Set(photos.map((photo) => photo.position));
    for (let index = 0; index < PHOTOS_MAX; index += 1) {
      if (!taken.has(index)) {
        return index;
      }
    }
    return null;
  };

  // A synchronous latch, not `upload.isPending`. Two surfaces drive this one
  // picker - the dashed tile in the grid and the docked button the signup
  // step hands it to through registerPick - and only the tile is disabled
  // while an upload runs. So the button could open a second picker over the
  // first, and because `nextPosition()` is computed from a list the first
  // upload has not landed in yet, both picks resolved to the SAME slot: two
  // photos at one position, which is how a cover stops being a single thing.
  // A ref rather than state because two taps in one frame must not both read
  // false, and this is checked and set before any await.
  const picking = useRef(false);

  const pick = async () => {
    if (userId == null || picking.current) {
      return;
    }
    picking.current = true;
    try {
      await pickOne();
    } finally {
      picking.current = false;
    }
  };

  const pickOne = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      // `aspect` is Android-only and the iOS editor is always square, so the
      // grid below shows squares: what they cropped is what they get.
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 1,
    });
    if (picked.canceled || picked.assets.length === 0) {
      return;
    }
    // Recomputed after the picker await: the list can move while it is open,
    // and a stale slot would quietly make a second cover.
    const position = nextPosition();
    if (position == null) {
      return;
    }
    try {
      await upload.mutateAsync({ localUri: picked.assets[0].uri, position });
      haptics.success();
    } catch {
      // Surfaced by the global mutation error alert; nothing to undo here.
    }
  };

  // The registration is done once per `registerPick` identity, and the ref is
  // what keeps the handed-out function pointing at the current `pick` — which
  // closes over `photos` and so changes on every render. Registering `pick`
  // itself would either re-register every render or freeze the parent's
  // button on the first render's photo list.
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });
  useEffect(() => {
    registerPick?.(() => {
      void pickRef.current();
    });
  }, [registerPick]);

  const coverId = coverIdOf(photos);

  const confirmRemove = (photo: PhotoRow) => {
    Alert.alert(
      photo.id === coverId ? 'Remove your cover photo?' : 'Remove this photo?',
      // Said, rather than implied. A photo is destroyed the moment this is
      // tapped, while everything else on the editor is held until Save, and
      // "Discard your changes?" afterwards cannot bring it back.
      'This one goes now, and it cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(photo) },
      ]
    );
  };

  return (
    <View
      style={styles.block}
      onLayout={(event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))}>
      <ThemedText type="footnote" themeColor="textSecondary">
        Photos of the business, not of a person. The first one that clears is your cover.
      </ThemedText>
      {/* A failed read is not "no photos". This grid answered `permission
          denied` with an empty add tile for three e2e runs straight — the
          upload succeeded, the read-back failed, and "0 of 10" was a lie. */}
      {photosQuery.isError ? (
        <LoadError
          compact
          what="your photos"
          error={photosQuery.error}
          onRetry={() => photosQuery.refetch()}
        />
      ) : size > 0 ? (
        <View style={[styles.grid, { gap: PHOTO_GAP }]}>
          {photos.map((photo) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              size={size}
              cover={photo.id === coverId}
              onRemove={() => confirmRemove(photo)}
            />
          ))}
          {full ? null : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={photos.length === 0 ? 'Add your cover photo' : 'Add a photo'}
              haptic="soft"
              scaleTo={0.97}
              disabled={upload.isPending}
              onPress={pick}
              containerStyle={{ width: size, height: size }}
              style={[
                styles.tile,
                styles.emptyTile,
                // `hairline` is documented as decorative and measures 1.5:1
                // against the canvas, so the "add a photo" tile was a bare
                // glyph floating beside filled squares with no box around it.
                // Same treatment the storefront screen gives its empty frame.
                {
                  width: size,
                  height: size,
                  backgroundColor: theme.surfaceSunken,
                  borderColor: theme.border,
                },
              ]}>
              {upload.isPending ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <SymbolView
                  name={{ ios: 'plus', android: 'add', web: 'add' }}
                  size={22}
                  tintColor={theme.textSecondary}
                />
              )}
            </PressableScale>
          )}
        </View>
      ) : (
        <View style={[styles.gridPlaceholder, { backgroundColor: theme.surfaceSunken }]} />
      )}
      {/* Only while there are photos and none of them has cleared. Silence
          here was the editor's other half of the same lie: a "Cover" chip on
          a photo nobody outside can see, and no word at all about the wait. */}
      {!photosQuery.isError && photos.length > 0 && coverId == null ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          Nobody sees a cover until one of these clears.
        </ThemedText>
      ) : null}
      {photosQuery.isError ? null : (
        <ThemedText type="footnote" themeColor="textSecondary">
          {photos.length} of {PHOTOS_MAX}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignSelf: 'stretch',
    gap: Space.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridPlaceholder: {
    height: 120,
    borderRadius: Radius.lg,
  },
  tile: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTile: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  tileChipAnchor: {
    position: 'absolute',
    left: Space.sm,
    bottom: Space.sm,
  },
  tileChip: {
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    // 10 + 24 + 10 = 44, the same arithmetic the remove dot on this tile
    // uses. The chip is a CONTROL now - it opens the sheet naming the reason
    // - and caption type on two points of padding is a 19pt box, so even with
    // hitSlop it came to 39 against a 44 floor. The minimum grows the box by
    // five points and centres the word in it; nothing else on the tile moves.
    minHeight: 24,
    justifyContent: 'center',
  },
  whyBody: {
    gap: Space.sm,
    paddingBottom: Space.lg,
  },
  whyActions: {
    gap: Space.sm,
  },
  removeAnchor: {
    position: 'absolute',
    right: Space.xs,
    top: Space.xs,
  },
  removeDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
