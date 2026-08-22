import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { PhotoScrim } from '@/components/ui/photo-scrim';
import { Elevation, Radius, Space } from '@/constants/theme';
import { usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';

/**
 * The photo-forward header both profile screens open with: one large 4:5
 * image with the name sitting on it. Leading with the face is what every
 * profile-driven app converged on — it makes the person, not the form fields,
 * the thing you react to (docs/DESIGN.md).
 */
export function ProfileHero({
  storagePath,
  name,
  age,
  verified,
  subtitle,
}: {
  storagePath: string | null;
  name: string;
  age: number | null;
  verified: boolean;
  subtitle?: string | null;
}) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(storagePath);

  return (
    <View style={[styles.hero, { backgroundColor: theme.surfaceSunken }]}>
      {url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <SymbolView
            name={{ ios: 'person.fill', android: 'person', web: 'person' }}
            size={56}
            tintColor={theme.textSecondary}
          />
        </View>
      )}
      <PhotoScrim />
      <View style={styles.overlay}>
        <View style={styles.nameRow}>
          <ThemedText type="title" style={styles.onPhoto} numberOfLines={1}>
            {name}
            {age != null ? `, ${age}` : ''}
          </ThemedText>
          {verified ? <VerifiedSeal size={20} name={name} age={age} onPhoto /> : null}
        </View>
        {subtitle ? (
          <ThemedText type="callout" style={styles.onPhotoSecondary} numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    ...Elevation.raised,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    padding: Space.lg,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  onPhoto: {
    color: '#FFFFFF',
    flexShrink: 1,
  },
  onPhotoSecondary: {
    color: 'rgba(255,255,255,0.88)',
  },
});
