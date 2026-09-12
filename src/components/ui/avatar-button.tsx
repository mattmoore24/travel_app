import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass-surface';
import { PressableScale } from '@/components/ui/pressable-scale';
import { RemoteImage } from '@/components/ui/remote-image';
import { HitTarget, Motion, Radius } from '@/constants/theme';
import { useBusinessDetail, useOwnBusiness } from '@/features/business/hooks';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { useOwnPhotos, usePhotoSourceState } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { photoSourceState } from '@/lib/photo-source';

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
  //
  // Both halves carry the storage path as expo-image's cache key, so this
  // face is fetched once per photo rather than once per launch. It is on
  // screen over the map and over Travelers, so before this it was re-pulled
  // on every cold start of every session. The business half pairs the URL
  // hook with `photoSourceState` by hand instead of using
  // `useBusinessPhotoSourceState`, because src/app/__tests__/business-home.test.ts
  // scans this file for the signer by name; the two are the same call, and
  // moving to the hook belongs with that scan's own edit.
  const coverPath = detail?.photos[0]?.storage_path ?? null;
  const cover = useBusinessPhotoUrl(coverPath);
  const ownPhotos = useOwnPhotos();
  const photos = ownPhotos.data ?? [];
  const main = photos.find((p) => p.position === 0) ?? photos[0] ?? null;
  const own = usePhotoSourceState(main?.storage_path ?? null);
  // While the photo LIST is still on its way the path is unknown, which is
  // not the same as no photo: the silhouette used to show on every launch
  // until the list landed, then the face popped in over it. A disabled query
  // (a visitor with no session) is idle and pending forever, and for them the
  // silhouette is the honest answer, so idle is settled here.
  const listPending = ownPhotos.isPending && ownPhotos.fetchStatus !== 'idle';

  const picture = business
    ? photoSourceState(cover, coverPath)
    : { source: own.source, pending: own.pending || (main == null && listPending) };
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
        {/* 'flat': the glass disc is the placeholder while the face is on
            its way, and a pulse inside a 44pt button reads as a flicker.
            The frame's own ground is cleared so the glass shows through
            behind a face that has not landed. */}
        <RemoteImage
          source={picture.source}
          pending={picture.pending}
          skeleton="flat"
          transition={Motion.quick}
          style={[styles.fill, styles.clear]}
          fallback={
            business && initial !== '' ? (
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
            )
          }
        />
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
  clear: {
    backgroundColor: 'transparent',
  },
});
