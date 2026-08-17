import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { GlassSurface } from '@/components/ui/glass-surface';
import { HitTarget, Radius } from '@/constants/theme';
import { useOwnPhotos, usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';

/**
 * The way into Profile now that the tab bar is down to three (docs/DESIGN.md).
 * Floats over the Map and Travelers content in glass; signed-out visitors get
 * the same target, which takes them to sign-in.
 */
export function AvatarButton() {
  const theme = useTheme();
  const { data: photos = [] } = useOwnPhotos();
  const main = photos.find((p) => p.position === 0) ?? photos[0] ?? null;
  const { data: url } = usePhotoUrl(main?.storage_path ?? null);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      hitSlop={8}
      onPress={() => router.push('/profile-me')}
      style={({ pressed }) => pressed && styles.pressed}>
      <GlassSurface variant="clear" radius={Radius.pill} style={styles.surface}>
        <View style={styles.inner}>
          {url ? (
            <Image source={{ uri: url }} style={styles.fill} contentFit="cover" />
          ) : (
            <SymbolView
              name={{ ios: 'person.fill', android: 'person', web: 'person' }}
              size={18}
              tintColor={theme.text}
            />
          )}
        </View>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: {
    width: HitTarget,
    height: HitTarget,
  },
  inner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  pressed: {
    opacity: 0.7,
  },
});
