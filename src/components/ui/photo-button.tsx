import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';

import { HitTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Attach a photo to a message. Camera first on a device, library as the
 * fallback (and the only option on web). The picked image goes through the
 * shared upload pipeline and the server's photo moderation gate.
 */
export function PhotoButton({
  onPick,
  busy = false,
  disabled = false,
}: {
  onPick: (localUri: string) => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();

  const pick = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (!picked.canceled && picked.assets.length > 0) {
      onPick(picked.assets[0].uri);
    }
  };

  const choose = () => {
    Alert.alert('Add a photo', undefined, [
      {
        text: 'Take a photo',
        onPress: async () => {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            await pick();
            return;
          }
          const shot = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 1,
          });
          if (!shot.canceled && shot.assets.length > 0) {
            onPick(shot.assets[0].uri);
          }
        },
      },
      { text: 'Choose from library', onPress: pick },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a photo"
      disabled={disabled || busy}
      onPress={choose}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      {busy ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : (
        <SymbolView
          name={{ ios: 'photo.on.rectangle', android: 'image', web: 'image' }}
          size={22}
          tintColor={disabled ? theme.textSecondary : theme.accent}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
