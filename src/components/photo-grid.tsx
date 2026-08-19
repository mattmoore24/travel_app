import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

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
import type { ProfilePhotoRow } from '@/lib/database.types';

const EXTRA_COLUMNS = 3;
const GAP = Space.sm;
/** Portrait, like every photo people already have of themselves. */
const RATIO = 5 / 4;

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
export function PhotoGrid() {
  const theme = useTheme();
  const { data: photos = [] } = useOwnPhotos();
  const uploadPhoto = useUploadPhoto();
  const [width, setWidth] = useState(0);

  const main = photos.find((p) => p.position === 0) ?? null;
  const extras = photos.filter((p) => p.position !== 0);

  const mainWidth = width > 0 ? Math.min(width, 220) : 0;
  const extraWidth =
    width > 0 ? Math.floor((width - GAP * (EXTRA_COLUMNS - 1)) / EXTRA_COLUMNS) : 0;

  const nextPosition = () => {
    const taken = new Set(photos.map((p) => p.position));
    for (let i = 0; i < PHOTOS_MAX; i += 1) {
      if (!taken.has(i)) {
        return i;
      }
    }
    return null;
  };

  const pickAndUpload = async (preferred: number | null) => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 1,
    });
    if (picked.canceled || picked.assets.length === 0) {
      return;
    }
    // Recomputed after the picker await: the list can change while the sheet
    // is open, and a stale slot would make a second "profile photo".
    const position =
      preferred != null && !photos.some((p) => p.position === preferred)
        ? preferred
        : nextPosition();
    if (position == null) {
      return;
    }
    try {
      await uploadPhoto.mutateAsync({ localUri: picked.assets[0].uri, position });
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
          <View style={styles.mainBlock}>
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
            <View style={styles.mainCaption}>
              <ThemedText type="callout">Profile photo</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {main
                  ? 'This is the one people see first.'
                  : 'Required. A clear photo of your face works best.'}
              </ThemedText>
            </View>
          </View>

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
              {photos.length < PHOTOS_MAX ? (
                <EmptySlot
                  width={extraWidth}
                  height={extraWidth * RATIO}
                  main={false}
                  busy={uploadPhoto.isPending}
                  onPress={() => pickAndUpload(null)}
                />
              ) : null}
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
  mainBlock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Space.lg,
  },
  mainCaption: {
    flex: 1,
    gap: Space.xs,
    paddingBottom: Space.sm,
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
