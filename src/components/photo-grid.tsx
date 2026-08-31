import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  PixelRatio,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Space } from '@/constants/theme';
import {
  useDeletePhoto,
  useOwnPhotos,
  usePhotoUrl,
  useUploadPhoto,
} from '@/features/profile/hooks';
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

function StatusChip({ status }: { status: ProfilePhotoRow['moderation_status'] }) {
  const theme = useTheme();
  if (status === 'approved') {
    return null;
  }
  const rejected = status === 'rejected';
  return (
    <View style={[styles.statusChip, { backgroundColor: rejected ? theme.danger : theme.surface }]}>
      <ThemedText type="caption" style={rejected ? { color: theme.onAccent } : undefined}>
        {rejected ? 'Removed' : 'In review'}
      </ThemedText>
    </View>
  );
}

function RemoveButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Remove photo"
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

function FilledPhoto({
  photo,
  width,
  height,
  main,
}: {
  photo: ProfilePhotoRow;
  width: number;
  height: number;
  main: boolean;
}) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(photo.storage_path);
  const deletePhoto = useDeletePhoto();

  const confirmDelete = () => {
    Alert.alert(main ? 'Remove your profile photo?' : 'Remove this photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deletePhoto.mutate(photo) },
    ]);
  };

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      layout={LinearTransition.springify()}
      style={[styles.tile, { width, height, backgroundColor: theme.surfaceSunken }]}>
      {url ? <Image source={{ uri: url }} style={styles.fill} contentFit="cover" /> : null}
      <StatusChip status={photo.moderation_status} />
      <RemoveButton onPress={confirmDelete} />
    </Animated.View>
  );
}

function EmptySlot({
  width,
  height,
  main,
  busy,
  onPress,
}: {
  width: number;
  height: number;
  main: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={main ? 'Add your profile photo' : 'Add a photo'}
      haptic="soft"
      scaleTo={0.97}
      disabled={busy}
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
          any caption lives under the tile instead of pushing it off. */}
      {busy ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        <SymbolView
          name={{ ios: 'plus', android: 'add', web: 'add' }}
          size={main ? 30 : 22}
          tintColor={main ? theme.accent : theme.textSecondary}
        />
      )}
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
  const [width, setWidth] = useState(0);
  // The library permission was refused and iOS will not ask again. Without
  // this the plus tile did nothing, forever, on the one step of signup that
  // cannot be skipped.
  const [libraryBlocked, setLibraryBlocked] = useState(false);

  const main = photos.find((p) => p.position === 0) ?? null;
  const extras = photos.filter((p) => p.position !== 0);
  // Enough tiles to reach a profile that looks looked-after, plus one spare
  // beyond whatever is already there, capped at what the schema allows.
  const emptySlots = Math.max(
    0,
    Math.min(Math.max(GALLERY_TARGET - 1, extras.length + 1), PHOTOS_MAX - 1) - extras.length
  );

  // At accessibility sizes the side caption laddered word by word in a
  // ~134pt column; a full-width tile with the caption underneath reads.
  const stackCaption = PixelRatio.getFontScale() > CAPTION_STACK_SCALE;

  const mainWidth = width > 0 ? (stackCaption ? width : Math.min(width, 220)) : 0;
  const extraWidth =
    width > 0 ? Math.floor((width - GAP * (EXTRA_COLUMNS - 1)) / EXTRA_COLUMNS) : 0;

  // `from` matters: deleting the main photo leaves slot 0 free, and an
  // "add another photo" tap must not quietly become the profile photo.
  const nextPosition = (from = 0) => {
    const taken = new Set(photos.map((p) => p.position));
    for (let i = from; i < PHOTOS_MAX; i += 1) {
      if (!taken.has(i)) {
        return i;
      }
    }
    return null;
  };

  const pickAndUpload = async (preferred: number | null, from = 0) => {
    // pickImage owns the action sheet: 'Take a photo' / 'Choose from
    // library' / 'Cancel', with the camera-permission ask and the silent
    // library fallback. NOT lib/live-camera — that module is the
    // verification-selfie path and its own test forbids a library import.
    // allowsEditing keeps the square system editor (and with it the Photos
    // authorisation sheet); the camera option is what removes the dead end
    // for anyone who refuses that sheet.
    const uri = await pickImage({
      allowsEditing: true,
      onLibraryBlocked: () => setLibraryBlocked(true),
    });
    if (uri == null) {
      return;
    }
    // Recomputed after the picker await: the list can change while the sheet
    // is open, and a stale slot would make a second "profile photo".
    const position =
      preferred != null && !photos.some((p) => p.position === preferred)
        ? preferred
        : nextPosition(from);
    if (position == null) {
      return;
    }
    try {
      await uploadPhoto.mutateAsync({ localUri: uri, position });
      haptics.success();
    } catch {
      Alert.alert('Upload failed', 'Check your connection and try again.');
    }
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
              <FilledPhoto photo={main} width={mainWidth} height={mainWidth * RATIO} main />
            ) : (
              <EmptySlot
                width={mainWidth}
                height={mainWidth * RATIO}
                main
                busy={uploadPhoto.isPending}
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
            <ThemedText type="footnote" themeColor="textSecondary">
              More photos, all optional
            </ThemedText>
            <View style={[styles.extras, { gap: GAP }]}>
              {extras.map((photo) => (
                <FilledPhoto
                  key={photo.id}
                  photo={photo}
                  width={extraWidth}
                  height={extraWidth * RATIO}
                  main={false}
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
                  busy={uploadPhoto.isPending}
                  onPress={() => pickAndUpload(null, 1)}
                />
              ))}
            </View>
          </View>
        </>
      ) : (
        <View style={[styles.placeholder, { backgroundColor: theme.surfaceSunken }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    gap: Space.xl,
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
  statusChip: {
    position: 'absolute',
    left: Space.sm,
    bottom: Space.sm,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
  },
  removeAnchor: {
    position: 'absolute',
    right: Space.xs,
    top: Space.xs,
  },
  remove: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
