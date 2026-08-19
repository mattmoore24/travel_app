import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { GlassSurface } from '@/components/ui/glass-surface';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius } from '@/constants/theme';
import { useOwnPhotos, usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';

/**
 * The way into Profile now that the tab bar is down to three (docs/DESIGN.md).
 * Floats over the Map and Travelers content in glass; signed-out visitors get
 * the same target, which takes them to sign-in.
 *
 * The glass is decorative (`pointerEvents="none"`): touches land on the
 * PressableScale itself, which is what makes the first tap reliable — the
 * native glass view otherwise competes for the gesture.
 */
export function AvatarButton() {
  const theme = useTheme();
  const { data: photos = [] } = useOwnPhotos();
  const main = photos.find((p) => p.position === 0) ?? photos[0] ?? null;
  const { data: url } = usePhotoUrl(main?.storage_path ?? null);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      hitSlop={8}
      scaleTo={0.9}
      haptic="soft"
      onPress={() => router.push('/profile-me')}>
      <GlassSurface
        variant="clear"
        radius={Radius.pill}
        pointerEvents="none"
        style={styles.surface}>
        {url ? (
          <Image source={{ uri: url }} style={styles.fill} contentFit="cover" />
        ) : (
          <SymbolView
            name={{ ios: 'person.fill', android: 'person', web: 'person' }}
            size={18}
            tintColor={theme.text}
            style={styles.icon}
          />
        )}
      </GlassSurface>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  surface: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    alignSelf: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
