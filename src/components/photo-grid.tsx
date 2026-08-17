import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  useDeletePhoto,
  useOwnPhotos,
  usePhotoUrl,
  useUploadPhoto,
} from '@/features/profile/hooks';
import { PHOTOS_MAX } from '@/features/profile/validation';
import { useTheme } from '@/hooks/use-theme';
import type { ProfilePhotoRow } from '@/lib/database.types';

const GRID_COLUMNS = 3;
const GRID_GAP = Spacing.two;

function PhotoCell({ photo, size }: { photo: ProfilePhotoRow; size: number }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(photo.storage_path);
  const deletePhoto = useDeletePhoto();

  const confirmDelete = () => {
    Alert.alert('Remove photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => deletePhoto.mutate(photo),
      },
    ]);
  };

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={photo.position === 0 ? 'Profile picture' : 'Gallery photo'}
      onLongPress={confirmDelete}
      style={[
        styles.cell,
        { width: size, height: size, backgroundColor: theme.backgroundElement },
      ]}>
      {url ? <Image source={{ uri: url }} style={styles.image} contentFit="cover" /> : null}
      {photo.position === 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.tint }]}>
          <ThemedText type="small" style={{ color: theme.onTint }}>
            Main
          </ThemedText>
        </View>
      ) : null}
      {photo.moderation_status !== 'approved' ? (
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                photo.moderation_status === 'rejected' ? theme.danger : theme.background,
            },
          ]}>
          <ThemedText
            type="small"
            style={photo.moderation_status === 'rejected' ? { color: theme.onTint } : undefined}>
            {photo.moderation_status === 'rejected' ? 'Removed' : 'In review'}
          </ThemedText>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Remove photo"
        onPress={confirmDelete}
        hitSlop={8}
        style={[styles.remove, { backgroundColor: theme.background }]}>
        <SymbolView
          name={{ ios: 'xmark', android: 'close', web: 'close' }}
          size={12}
          tintColor={theme.text}
        />
      </Pressable>
    </Pressable>
  );
}

/**
 * The 9-slot photo manager (slot 0 = main profile picture). Uploads are
 * resized client-side and land in the private bucket. With photo moderation
 * enabled server-side, new photos hold at "In review" (visible only to the
 * owner) until the moderation worker approves or removes them.
 */
export function PhotoGrid() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { data: photos = [] } = useOwnPhotos();
  const uploadPhoto = useUploadPhoto();

  const contentWidth = Math.min(width, 800) - Spacing.four * 2;
  const cellSize = Math.floor((contentWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);

  const nextPosition = () => {
    const taken = new Set(photos.map((p) => p.position));
    for (let i = 0; i < PHOTOS_MAX; i += 1) {
      if (!taken.has(i)) {
        return i;
      }
    }
    return null;
  };

  const pickAndUpload = async () => {
    if (nextPosition() == null) {
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 1,
    });
    if (picked.canceled || picked.assets.length === 0) {
      return;
    }
    // Recompute after the picker await — the photo list may have changed while
    // the sheet was open, and a stale slot would create two "Main" photos.
    const position = nextPosition();
    if (position == null) {
      return;
    }
    try {
      await uploadPhoto.mutateAsync({ localUri: picked.assets[0].uri, position });
    } catch {
      Alert.alert('Upload failed', 'Check your connection and try again.');
    }
  };

  return (
    <View style={[styles.grid, { gap: GRID_GAP }]}>
      {photos.map((photo) => (
        <PhotoCell key={photo.id} photo={photo} size={cellSize} />
      ))}
      {photos.length < PHOTOS_MAX ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add photo"
          onPress={pickAndUpload}
          disabled={uploadPhoto.isPending}
          style={({ pressed }) => [
            styles.cell,
            styles.addCell,
            {
              width: cellSize,
              height: cellSize,
              backgroundColor: theme.backgroundElement,
              opacity: pressed || uploadPhoto.isPending ? 0.6 : 1,
            },
          ]}>
          <SymbolView
            name={{ ios: 'plus', android: 'add', web: 'add' }}
            size={24}
            tintColor={theme.textSecondary}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {photos.length === 0 ? 'Add profile photo' : 'Add'}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  addCell: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    left: Spacing.two,
    bottom: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  statusBadge: {
    position: 'absolute',
    right: Spacing.two,
    bottom: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  remove: {
    position: 'absolute',
    right: Spacing.two,
    top: Spacing.two,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
