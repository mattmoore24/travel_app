import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Linking, PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { PhotoCheckVeil } from '@/components/ui/photo-check';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet, leavingSheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { photoRejection } from '@/constants/moderation';
import { Radius, Space } from '@/constants/theme';
import {
  useDeletePhoto,
  useOwnPhotos,
  useOwnProfile,
  usePhotoUrl,
  useReorderPhotos,
  useUploadPhoto,
} from '@/features/profile/hooks';
import { photoWritePlan, reorderedPhotos } from '@/features/profile/photo-order';
import { PHOTOS_MAX } from '@/features/profile/validation';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { pickImage } from '@/lib/pick-image';
import type { ProfilePhotoRow } from '@/lib/database.types';

/**
 * How many photos a profile should be nudged toward. Not a limit — the cap
 * is PHOTOS_MAX — just the number of dashed tiles that stay on screen so the
 * page keeps looking like it has room.
 */
const GALLERY_TARGET = 6;

const EXTRA_COLUMNS = 3;
const GAP = Space.sm;
/**
 * Square, because square is what people approved: the iOS system editor
 * always crops square, and drawing that square into a taller frame cropped a
 * further fifth off each side — shoulders, and on a close portrait, ears.
 * The tile shows exactly the frame the person framed.
 */
const RATIO = 1;
/** Past this font scale the tile-plus-side-caption row becomes a column. */
const CAPTION_STACK_SCALE = 1.3;
/** Under this the wait card's sentence does not fit; the headline still does. */
const CHECK_CARD_MIN = 160;

/**
 * A photo that has been picked and cropped but is not a row yet.
 *
 * It exists so the file survives the upload. The grid used to hold nothing
 * between the picker closing and the row landing, so a failure on hostel wifi
 * threw the photo away and sent the person back into a library of thousands
 * to find and re-crop the same one.
 */
type PendingUpload = {
  /**
   * Identity, and it has to be one. Slot is not identity: a pending entry
   * that was only ever HIDDEN by "a row now occupies this slot" comes back
   * the moment that slot is freed. Upload a photo to slot 0 on the mandatory
   * signup step, then delete it, and the finished upload reappears as an
   * 'Uploading' tile that never finishes, over a slot with nothing in it.
   */
  token: number;
  localUri: string;
  position: number;
  state: 'uploading' | 'failed';
};

/** Monotonic, per mount. Nothing derives meaning from the value. */
let pendingToken = 0;

/**
 * What happened to this photo, and - when something did - why.
 *
 * The old version drew one word on danger red for every non-approved photo,
 * which said "you broke the rules" to somebody whose photo had merely timed
 * out. Two states now: a failsafe hold is 'Try again' on warning, a rules
 * rejection is 'Removed' on danger, and both open a sheet naming the reason
 * in copy this app owns (src/constants/moderation.ts), because a reason you
 * cannot read is a reason you cannot act on. The business grid draws the
 * identical pair from the identical helper (src/app/business-edit.tsx), so
 * one verdict has one word and one colour in both account kinds.
 */
function StatusChip({ photo }: { photo: ProfilePhotoRow }) {
  const theme = useTheme();
  const router = useRouter();
  const [explaining, setExplaining] = useState(false);

  if (photo.moderation_status === 'approved') {
    return null;
  }
  if (photo.moderation_status !== 'rejected') {
    return (
      <View style={[styles.statusAnchor, styles.statusChip, { backgroundColor: theme.surface }]}>
        <ThemedText type="caption">In review</ThemedText>
      </View>
    );
  }

  const why = photoRejection(photo.moderation_category, photo.moderation_engine);
  const close = () => setExplaining(false);
  // Navigating out from under a presented Sheet leaves its scrim over the
  // screen and kills every tap behind it. Dismiss first, push after.
  const leave = leavingSheet(close);

  return (
    <>
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
        containerStyle={styles.statusAnchor}
        style={[
          styles.statusChip,
          { backgroundColor: why.failsafe ? theme.warning : theme.danger },
        ]}>
        <ThemedText type="caption" style={{ color: theme.onHighlight }}>
          {why.chip}
        </ThemedText>
      </PressableScale>
      {explaining ? (
        <Sheet onClose={close}>
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
                onPress={() => leave(() => router.push('/contact'))}
              />
            )}
            <PrimaryButton label="Done" accessibilityLabel="Done" onPress={close} />
          </View>
        </Sheet>
      ) : null}
    </>
  );
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      // Names WHICH photo goes. "Remove photo" on six identical dots told a
      // screen reader nothing about which one it was about to delete.
      accessibilityLabel={label}
      haptic="light"
      scaleTo={0.88}
      // 10 + 24 + 10 = 44. The dot stays small; the target does not. hitSlop
      // is honoured by the Pressable itself, so the tile's overflow: hidden
      // does not clip it.
      hitSlop={10}
      onPress={onPress}
      containerStyle={styles.removeAnchor}
      style={[styles.remove, { backgroundColor: theme.surface }]}>
      <SymbolView
        name={{ ios: 'xmark', android: 'close', web: 'close' }}
        size={11}
        tintColor={theme.text}
      />
    </PressableScale>
  );
}

/** What this photo is, and what is happening to it, in one spoken sentence. */
function photoLabel(name: string, photo: ProfilePhotoRow): string {
  if (photo.moderation_status === 'approved') {
    return name;
  }
  if (photo.moderation_status !== 'rejected') {
    return `${name}, being checked`;
  }
  return photoRejection(photo.moderation_category, photo.moderation_engine).failsafe
    ? `${name}, could not be checked`
    : `${name}, removed`;
}

function FilledPhoto({
  photo,
  name,
  width,
  height,
  main,
  onArrange,
}: {
  photo: ProfilePhotoRow;
  /** "Your profile photo" / "Photo 3" — the thing the labels are built from. */
  name: string;
  width: number;
  height: number;
  main: boolean;
  /**
   * Open the order sheet for this photo. Absent while an upload is in
   * flight: a reorder renumbers every row to 0..n-1 and would land on the
   * slot that upload is holding.
   */
  onArrange?: () => void;
}) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(photo.storage_path);
  const { data: profile } = useOwnProfile();
  const deletePhoto = useDeletePhoto();
  const checking = photo.moderation_status !== 'approved' && photo.moderation_status !== 'rejected';

  const confirmDelete = () => {
    // The seal was issued against the photos that led at the time
    // (20260904100000), and removing the main one can take it off if the
    // next photo was never checked. Said before the tap, on the one tile
    // where it can happen, and not on the arrange sheet: a reorder that
    // costs the badge is the person choosing a new face, and that sheet is
    // not the place to argue with them.
    Alert.alert(
      main ? 'Remove your profile photo?' : 'Remove this photo?',
      main && profile?.verified
        ? 'Your badge may come off, since it was checked against this photo. A new selfie brings it back.'
        : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => deletePhoto.mutate(photo) },
      ]
    );
  };

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      layout={LinearTransition.springify()}
      style={[styles.tile, { width, height, backgroundColor: theme.surfaceSunken }]}>
      {url ? (
        <Image
          source={{ uri: url }}
          style={styles.fill}
          contentFit="cover"
          // A "Photos" heading over unlabelled images is a heading over
          // nothing, as far as VoiceOver is concerned — the same reason the
          // business side labels its own (src/app/place/[id].tsx).
          accessibilityLabel={photoLabel(name, photo)}
        />
      ) : (
        // Loading, not empty. A flat grey square is indistinguishable from a
        // broken one on the connections this app is used on.
        <Skeleton style={StyleSheet.absoluteFill} radius={0} />
      )}
      {/* The wait says why and for how long, in the same words a chat photo
          gets. Only where the card fits: on a 110pt extras tile the chip is
          the whole of what can be read. */}
      {checking && width >= CHECK_CARD_MIN ? <PhotoCheckVeil /> : <StatusChip photo={photo} />}
      <RemoveButton label={`Remove ${name.toLowerCase()}`} onPress={confirmDelete} />
      {onArrange ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Move ${name.toLowerCase()}`}
          accessibilityHint="Choose where this photo goes in the order."
          haptic="light"
          scaleTo={0.88}
          hitSlop={10}
          onPress={onArrange}
          containerStyle={styles.arrangeAnchor}
          style={[styles.remove, { backgroundColor: theme.surface }]}>
          <SymbolView
            name={{ ios: 'arrow.up.arrow.down', android: 'swap_vert', web: 'swap_vert' }}
            size={12}
            tintColor={theme.text}
          />
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

/**
 * The photo somebody just picked, in the slot it is going to.
 *
 * Four grey dashed boxes all spinning while none of them contained the
 * picture was the old answer to "I just added a photo". This one shows the
 * file itself, dimmed, with a word for what is happening to it — and keeps
 * it when the upload fails, so trying again costs a tap rather than another
 * trip through the library and the crop editor.
 */
function PendingTile({
  upload,
  name,
  width,
  height,
  onRetry,
  onDiscard,
}: {
  upload: PendingUpload;
  name: string;
  width: number;
  height: number;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const theme = useTheme();
  const failed = upload.state === 'failed';

  const tile = (
    <>
      <Image
        source={{ uri: upload.localUri }}
        style={styles.fill}
        contentFit="cover"
        accessibilityLabel={failed ? undefined : `${name}, uploading`}
      />
      {/* Dimmed rather than faded: the veil sits over the picture and leaves
          the chip on it at full contrast, where an opacity on the tile would
          take the label down with the photo. */}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}
        pointerEvents="none"
      />
      <View
        style={[
          styles.statusAnchor,
          styles.statusChip,
          { backgroundColor: failed ? theme.danger : theme.surface },
        ]}>
        <ThemedText type="caption" style={failed ? { color: theme.onHighlight } : undefined}>
          {failed ? 'Not sent' : 'Uploading'}
        </ThemedText>
      </View>
    </>
  );

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      layout={LinearTransition.springify()}
      style={[styles.tile, { width, height, backgroundColor: theme.surfaceSunken }]}>
      {failed ? (
        // The same words the chat gives a message that did not go, because
        // it is the same event and a person should not have to learn it
        // twice.
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${name} was not sent. Tap to try again.`}
          haptic="light"
          scaleTo={0.97}
          onPress={onRetry}
          containerStyle={styles.fill}
          style={styles.fill}>
          {tile}
        </PressableScale>
      ) : (
        tile
      )}
      {failed ? <RemoveButton label={`Discard ${name.toLowerCase()}`} onPress={onDiscard} /> : null}
    </Animated.View>
  );
}

function EmptySlot({
  width,
  height,
  main,
  disabled,
  onPress,
}: {
  width: number;
  height: number;
  main: boolean;
  /** A pick is already open; a second one would stack two system sheets. */
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={main ? 'Add your profile photo' : 'Add a photo'}
      haptic="soft"
      scaleTo={0.97}
      disabled={disabled}
      onPress={onPress}
      containerStyle={{ width, height }}
      style={[
        styles.tile,
        styles.emptyTile,
        {
          width,
          height,
          backgroundColor: main ? theme.accentSoft : theme.surfaceSunken,
          borderColor: main ? theme.accent : theme.hairline,
        },
      ]}>
      {/* The glyph is the only thing in the box, so it sits dead centre —
          any caption lives under the tile instead of pushing it off. No
          spinner: the photo being uploaded now has a tile of its own with
          the picture in it, and the only wait this box ever covered was the
          system picker, which is drawn over the whole screen anyway. */}
      <SymbolView
        name={{ ios: 'plus', android: 'add', web: 'add' }}
        size={main ? 30 : 22}
        tintColor={main ? theme.accent : theme.textSecondary}
      />
    </PressableScale>
  );
}

/**
 * Photo manager for the profile. Slot 0 is drawn large and labelled as the
 * profile photo because it is the one that is actually required and the one
 * everybody sees first; the rest are a quiet row of optional extras.
 */
export function PhotoGrid({
  missingNote = 'Required. A clear photo of your face works best.',
}: {
  /**
   * The line under "Profile photo" while the required slot is empty.
   * Onboarding passes the reason instead of the requirement, because its own
   * footer already says a photo is needed and the caption used to state the
   * requirement twice on one screen.
   */
  missingNote?: string;
} = {}) {
  const theme = useTheme();
  const { data: photos = [] } = useOwnPhotos();
  const uploadPhoto = useUploadPhoto();
  const reorderPhotos = useReorderPhotos();
  const [width, setWidth] = useState(0);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [picking, setPicking] = useState(false);
  // The photo whose order sheet is open. One sheet for the whole grid rather
  // than one per tile: nine mounted <Modal>s is nine chances to present one
  // while another is dismissing, which on Fabric kills touch for the app.
  const [arranging, setArranging] = useState<ProfilePhotoRow | null>(null);
  // The library permission was refused and iOS will not ask again. Without
  // this the plus tile did nothing, forever, on the one step of signup that
  // cannot be skipped.
  const [libraryBlocked, setLibraryBlocked] = useState(false);

  // An upload that landed keeps its tile until the ROW arrives, not until the
  // mutation resolves: invalidateQueries is a refetch, so dropping the local
  // tile the moment the promise settles flashes the empty dashed box back on
  // screen for as long as that refetch takes.
  //
  // A 'landed' entry is shown only while its slot is still empty, and is
  // retired by the effect below once the row is really there. A 'uploading'
  // one is shown unconditionally - it is in flight, and hiding it because
  // some OTHER write filled the slot would lose the only sign that anything
  // is happening. Failed ones stay until they are retried or discarded.
  // Everything still in the list is genuinely in flight or genuinely failed:
  // a successful upload removes its own entry once the row is in the cache.
  const active = pending;

  const main = photos.find((p) => p.position === 0) ?? null;
  const extras = photos.filter((p) => p.position !== 0);
  const pendingMain = active.find((p) => p.position === 0) ?? null;
  const pendingExtras = active.filter((p) => p.position !== 0);
  const occupied = photos.length + active.length;
  // Enough tiles to reach a profile that looks looked-after, plus one spare
  // beyond whatever is already there, capped at what the schema allows.
  const shownExtras = extras.length + pendingExtras.length;
  const emptySlots = Math.max(
    0,
    Math.min(Math.max(GALLERY_TARGET - 1, shownExtras + 1), PHOTOS_MAX - 1) - shownExtras
  );

  // At accessibility sizes the side caption laddered word by word in a
  // ~134pt column; a full-width tile with the caption underneath reads.
  const stackCaption = PixelRatio.getFontScale() > CAPTION_STACK_SCALE;

  const mainWidth = width > 0 ? (stackCaption ? width : Math.min(width, 220)) : 0;
  const extraWidth =
    width > 0 ? Math.floor((width - GAP * (EXTRA_COLUMNS - 1)) / EXTRA_COLUMNS) : 0;

  // `from` matters: deleting the main photo leaves slot 0 free, and an
  // "add another photo" tap must not quietly become the profile photo. A
  // slot with an upload in flight counts as taken, or two files race for it.
  const nextPosition = (from = 0) => {
    const taken = new Set([...photos.map((p) => p.position), ...active.map((p) => p.position)]);
    for (let i = from; i < PHOTOS_MAX; i += 1) {
      if (!taken.has(i)) {
        return i;
      }
    }
    return null;
  };

  const send = async (localUri: string, position: number) => {
    const token = ++pendingToken;
    setPending((list) => [
      ...list.filter((item) => item.position !== position),
      { token, localUri, position, state: 'uploading' },
    ]);
    try {
      await uploadPhoto.mutateAsync({ localUri, position });
      haptics.success();
      // Retired outright, by TOKEN and never by slot. useUploadPhoto returns
      // its invalidation, so by the time this line runs the real row is in
      // the cache and there is nothing to flash. Marking it 'landed' and
      // leaving it in the list was the bug: the entry sat there inert until
      // somebody deleted that photo, and then came back as an 'Uploading'
      // tile over an empty slot that would never finish.
      setPending((list) => list.filter((item) => item.token !== token));
    } catch {
      // No Alert. The tile itself now says what happened and offers the one
      // thing worth doing about it, and an alert on top of it was a second
      // dismissal between the person and their retry.
      haptics.error();
      setPending((list) =>
        list.map((item) => (item.token === token ? { ...item, state: 'failed' } : item))
      );
    }
  };

  const pickAndUpload = async (preferred: number | null, from = 0) => {
    // pickImage owns the action sheet: 'Take a photo' / 'Choose from
    // library' / 'Cancel', with the camera-permission ask and the silent
    // library fallback. NOT lib/live-camera — that module is the
    // verification-selfie path and its own test forbids a library import.
    // allowsEditing keeps the square system editor (and with it the Photos
    // authorisation sheet); the camera option is what removes the dead end
    // for anyone who refuses that sheet.
    setPicking(true);
    let uri: string | null = null;
    try {
      uri = await pickImage({
        allowsEditing: true,
        onLibraryBlocked: () => setLibraryBlocked(true),
      });
    } finally {
      setPicking(false);
    }
    if (uri == null) {
      return;
    }
    // Recomputed after the picker await: the list can change while the sheet
    // is open, and a stale slot would make a second "profile photo".
    const position =
      preferred != null &&
      !photos.some((p) => p.position === preferred) &&
      !active.some((p) => p.position === preferred)
        ? preferred
        : nextPosition(from);
    if (position == null) {
      return;
    }
    await send(uri, position);
  };

  // The order people actually see, which is what "first" and "last" mean in
  // the sheet. fetchPhotos already sorts by position, so this is the same
  // list; sorting again keeps that true if the query ever stops.
  const ordered = [...photos].sort((a, b) => a.position - b.position);
  const arrangingIndex = arranging ? ordered.findIndex((p) => p.id === arranging.id) : -1;
  // Not while an upload is in flight: the reorder renumbers every row to
  // 0..n-1 and a photo on its way up is holding a slot no row has yet.
  const canArrange = ordered.length > 1 && active.length === 0;

  const move = (id: string, toIndex: number) => {
    const next = reorderedPhotos(photos, id, toIndex);
    setArranging(null);
    haptics.medium();
    reorderPhotos.mutate({ writes: photoWritePlan(photos, next), next });
  };

  const onLayout = (event: LayoutChangeEvent) => {
    // Measured, never assumed: the old grid hard-coded a page padding that
    // no longer matched its container, which is what knocked the empty
    // slots off centre.
    setWidth(Math.round(event.nativeEvent.layout.width));
  };

  return (
    <View style={styles.container} onLayout={onLayout}>
      {width > 0 ? (
        <>
          <View style={[styles.mainBlock, stackCaption && styles.mainBlockStacked]}>
            {main ? (
              <FilledPhoto
                photo={main}
                name="Your profile photo"
                width={mainWidth}
                height={mainWidth * RATIO}
                main
                onArrange={canArrange ? () => setArranging(main) : undefined}
              />
            ) : pendingMain ? (
              <PendingTile
                upload={pendingMain}
                name="Your profile photo"
                width={mainWidth}
                height={mainWidth * RATIO}
                onRetry={() => send(pendingMain.localUri, 0)}
                onDiscard={() => setPending((list) => list.filter((p) => p.position !== 0))}
              />
            ) : (
              <EmptySlot
                width={mainWidth}
                height={mainWidth * RATIO}
                main
                disabled={picking}
                onPress={() => pickAndUpload(0)}
              />
            )}
            <View style={[styles.mainCaption, stackCaption && styles.mainCaptionStacked]}>
              <ThemedText type="callout">Profile photo</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {main ? 'This is the one people see first.' : missingNote}
              </ThemedText>
            </View>
          </View>

          {libraryBlocked ? (
            <View style={styles.blockedRow}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Photos are off for Samewhere. Turn them on in Settings, or take one now.
              </ThemedText>
              <PrimaryButton
                variant="ghost"
                label="Open Settings"
                accessibilityLabel="Open Settings"
                onPress={() => {
                  Linking.openSettings().catch(() => {});
                }}
              />
            </View>
          ) : null}

          <View style={styles.extrasBlock}>
            {/* The cap, said out loud. The business grid has printed its own
                since it was built; the profile side had the same limit and
                never mentioned it, so the only way to find PHOTOS_MAX was to
                hit it. */}
            <View style={styles.extrasHeader}>
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.flex}>
                More photos, all optional
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {occupied} of {PHOTOS_MAX}
              </ThemedText>
            </View>
            <View style={[styles.extras, { gap: GAP }]}>
              {extras.map((photo, index) => (
                <FilledPhoto
                  key={photo.id}
                  photo={photo}
                  // Numbered by SLOT, the same basis the pending tiles use.
                  // Numbering filled tiles by their place in the rendered list
                  // and pending ones by their database slot made the two
                  // disagree the moment a slot was empty: with photos at slots
                  // 0 and 2 and a new one picked into slot 1, VoiceOver
                  // announced two different tiles as "Photo 2".
                  name={`Photo ${photo.position + 1}`}
                  width={extraWidth}
                  height={extraWidth * RATIO}
                  main={false}
                  onArrange={canArrange ? () => setArranging(photo) : undefined}
                />
              ))}
              {pendingExtras.map((item) => (
                <PendingTile
                  key={`pending-${item.token}`}
                  upload={item}
                  name={`Photo ${item.position + 1}`}
                  width={extraWidth}
                  height={extraWidth * RATIO}
                  onRetry={() => send(item.localUri, item.position)}
                  onDiscard={() =>
                    setPending((list) => list.filter((p) => p.position !== item.position))
                  }
                />
              ))}
              {/* Dashed tiles all the way to a full-looking profile, not the
                  single one this used to show. The nudge to add photos used
                  to stop dead after the first, so a profile with two photos
                  looked finished — and a profile that looks finished at two
                  photos is one nobody adds a third to. */}
              {Array.from({ length: emptySlots }, (_, index) => (
                <EmptySlot
                  key={`empty-${index}`}
                  width={extraWidth}
                  height={extraWidth * RATIO}
                  main={false}
                  disabled={picking}
                  onPress={() => pickAndUpload(null, 1)}
                />
              ))}
            </View>
          </View>
        </>
      ) : (
        <View style={[styles.placeholder, { backgroundColor: theme.surfaceSunken }]} />
      )}

      {/* Buttons, not a drag. Choosing which photo leads is the edit that
          decides whether anybody says hi, and it used to cost a destructive
          confirm, a storage delete, a re-pick, a re-crop and a fresh trip
          through moderation with no hero on the profile meanwhile. A press
          and hold to drag would be the iOS grammar for this, and it is also
          the gesture a scroller steals in the capture phase (see the traps
          skill) — so the reachable version ships, and it is the one VoiceOver
          can use either way. */}
      {arranging && arrangingIndex >= 0 ? (
        <Sheet onClose={() => setArranging(null)}>
          <View style={styles.orderBody}>
            <ThemedText type="title">Move this photo</ThemedText>
            <ThemedText type="body" themeColor="textSecondary">
              People see your photos in this order, and the first one is the one they see first.
            </ThemedText>
          </View>
          <View style={styles.orderActions}>
            {arrangingIndex > 0 ? (
              <PrimaryButton
                label="Make this my profile photo"
                accessibilityLabel="Make this my profile photo"
                onPress={() => move(arranging.id, 0)}
              />
            ) : null}
            {arrangingIndex > 0 ? (
              <PrimaryButton
                variant="ghost"
                label="Move it earlier"
                accessibilityLabel="Move it one place earlier"
                onPress={() => move(arranging.id, arrangingIndex - 1)}
              />
            ) : null}
            {arrangingIndex < ordered.length - 1 ? (
              <PrimaryButton
                variant="ghost"
                label="Move it later"
                accessibilityLabel="Move it one place later"
                onPress={() => move(arranging.id, arrangingIndex + 1)}
              />
            ) : null}
            <PrimaryButton
              variant="ghost"
              label="Leave it here"
              accessibilityLabel="Leave it here"
              onPress={() => setArranging(null)}
            />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    gap: Space.xl,
  },
  flex: {
    flex: 1,
  },
  placeholder: {
    height: 180,
    borderRadius: Radius.lg,
  },
  // Top-aligned: bottom-aligning the caption floated it at the foot of a
  // tall empty box, reading as detached from the tile it describes.
  mainBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.lg,
  },
  mainBlockStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  mainCaption: {
    flex: 1,
    gap: Space.xs,
    paddingBottom: Space.sm,
  },
  // In a column, flex: 1 with no definite parent height is the classic
  // zero-height collapse; size the caption by its own content instead.
  mainCaptionStacked: {
    flex: 0,
  },
  blockedRow: {
    gap: Space.xs,
  },
  extrasBlock: {
    gap: Space.sm,
  },
  extrasHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Space.sm,
  },
  extras: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  statusAnchor: {
    position: 'absolute',
    left: Space.sm,
    bottom: Space.sm,
  },
  statusChip: {
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
  // Opposite corner from Remove, and the far side from the status chip: the
  // four corners of a tile are the only places a control can sit without
  // covering the face.
  arrangeAnchor: {
    position: 'absolute',
    right: Space.xs,
    bottom: Space.xs,
  },
  orderBody: {
    gap: Space.sm,
    paddingBottom: Space.lg,
  },
  orderActions: {
    gap: Space.sm,
  },
  remove: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
