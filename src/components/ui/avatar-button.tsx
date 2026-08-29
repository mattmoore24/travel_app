import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass-surface';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius } from '@/constants/theme';
import { useBusinessDetail, useOwnBusiness } from '@/features/business/hooks';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { useOwnPhotos, usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';

/**
 * The way into Profile now that the tab bar is down to three (docs/DESIGN.md).
 * Floats over the Map and Travelers content in glass; signed-out visitors get
 * the same target, which takes them to sign-in.
 *
 * A business account gets its own face in it. This read `profile_photos` and
 * nothing else, a table a business can never have a row in, so the owner of a
 * bar looked at a generic person glyph labelled "Your profile" for the whole
 * life of an account that has no profile and can never have one. What a
 * business has instead is its cover photo, and failing that its name.
 *
 * The glass is decorative (`pointerEvents="none"`): touches land on the
 * PressableScale itself, which is what makes the first tap reliable — the
 * native glass view otherwise competes for the gesture.
 */
export function AvatarButton() {
  const theme = useTheme();
  const business = useOwnBusiness().data ?? null;
  const detail = useBusinessDetail(business?.id ?? null).data ?? null;
  // Both signings, and the right one wins below. A business path put through
  // the profile signer comes back a 404 wearing a valid-looking URL, which is
  // why there are two hooks rather than one (features/business/photo-url).
  const cover = useBusinessPhotoUrl(detail?.photos[0]?.storage_path ?? null);
  const { data: photos = [] } = useOwnPhotos();
  const main = photos.find((p) => p.position === 0) ?? photos[0] ?? null;
  const { data: url } = usePhotoUrl(main?.storage_path ?? null);

  const picture = business ? (cover.data ?? null) : (url ?? null);
  const initial = business?.name.trim().charAt(0).toUpperCase() ?? '';

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={business ? 'Your business' : 'Your profile'}
      // The label changes with the account kind, so the simulator suite
      // cannot drive this by its words. One id, both kinds.
      testID="header-account-button"
      hitSlop={8}
      scaleTo={0.9}
      haptic="soft"
      onPress={() => router.push('/profile-me')}>
      <GlassSurface
        variant="clear"
        radius={Radius.pill}
        pointerEvents="none"
        style={styles.surface}>
        {picture ? (
          <Image source={{ uri: picture }} style={styles.fill} contentFit="cover" />
        ) : business && initial !== '' ? (
          <ThemedText type="callout" style={styles.initial}>
            {initial}
          </ThemedText>
        ) : (
          <SymbolView
            name={
              business
                ? { ios: 'storefront.fill', android: 'storefront', web: 'storefront' }
                : { ios: 'person.fill', android: 'person', web: 'person' }
            }
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
  initial: {
    textAlign: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
