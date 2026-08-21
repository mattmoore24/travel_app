import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { HitTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pickImage } from '@/lib/pick-image';

/**
 * Attach a photo to a message. The asking is `lib/pick-image`, shared with
 * every other "add a photo" in the app so the camera-first fallback cannot
 * drift between them; this is only the button. What comes back goes through
 * the upload pipeline and the server's photo moderation gate.
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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a photo"
      disabled={disabled || busy}
      onPress={async () => {
        const uri = await pickImage();
        if (uri) {
          onPick(uri);
        }
      }}
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
