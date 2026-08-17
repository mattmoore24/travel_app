import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ProfileHero } from '@/components/ui/profile-hero';
import { LANGUAGES } from '@/constants/languages';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { signOut } from '@/features/auth/api';
import { deleteAccount } from '@/features/profile/api';
import {
  useLatestVerification,
  useOwnPhotos,
  useOwnProfile,
  useOwnSocialHandles,
  usePhotoUrl,
} from '@/features/profile/hooks';
import { GALLERY_TARGET } from '@/features/profile/validation';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/supabase';

const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.value, l.label])
);

function GalleryPhoto({ storagePath }: { storagePath: string }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(storagePath);
  return (
    <View style={[styles.galleryPhoto, { backgroundColor: theme.surfaceSunken }]}>
      {url ? <Image source={{ uri: url }} style={styles.fill} contentFit="cover" /> : null}
    </View>
  );
}

/** Empty slot that doubles as the call to action to fill the gallery out. */
function GallerySlot({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a photo"
      onPress={onPress}
      style={({ pressed }) => [
        styles.galleryPhoto,
        styles.slot,
        { borderColor: theme.hairline, opacity: pressed ? 0.6 : 1 },
      ]}>
      <SymbolView
        name={{ ios: 'plus', android: 'add', web: 'add' }}
        size={22}
        tintColor={theme.textSecondary}
      />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const { data: profile } = useOwnProfile();
  const { data: photos = [] } = useOwnPhotos();
  const { data: handles = [] } = useOwnSocialHandles();
  const { data: verification } = useLatestVerification();

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'person.crop.circle', android: 'person', web: 'person' }}
        title="Profile"
        phase="waiting on backend keys"
        description="Copy .env.example to .env with your Supabase project keys, restart the dev server, and sign in to build your profile."
      />
    );
  }

  const mainPhoto = photos.find((p) => p.position === 0) ?? photos[0] ?? null;
  const gallery = photos.filter((p) => p.id !== mainPhoto?.id);
  // Show the gap rather than describing it — empty slots up to the target read
  // as "finish this", which a sentence of copy never does.
  const emptySlots = Math.max(0, GALLERY_TARGET - gallery.length);
  const home = [profile?.home_city, profile?.home_country].filter(Boolean).join(', ');

  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ProfileHero
          storagePath={mainPhoto?.storage_path ?? null}
          name={profile?.display_name ?? 'Your profile'}
          age={profile?.age ?? null}
          verified={profile?.verified ?? false}
          subtitle={home || null}
        />

        {profile?.bio ? <ThemedText type="body">{profile.bio}</ThemedText> : null}

        {profile?.languages.length ? (
          <View style={styles.chipWrap}>
            {profile.languages.map((code) => (
              <ThemedView key={code} type="surfaceSunken" style={styles.chip}>
                <ThemedText type="footnote">{LANGUAGE_LABELS[code] ?? code}</ThemedText>
              </ThemedView>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText type="caption" themeColor="textSecondary">
            PHOTOS
          </ThemedText>
          <View style={styles.gallery}>
            {gallery.map((photo) => (
              <GalleryPhoto key={photo.id} storagePath={photo.storage_path} />
            ))}
            {Array.from({ length: emptySlots }, (_, i) => (
              <GallerySlot key={`slot-${i}`} onPress={() => router.push('/edit-profile')} />
            ))}
          </View>
        </View>

        <ThemedView type="surfaceSunken" style={styles.socialCard}>
          <View style={styles.socialHeader}>
            <SymbolView
              name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }}
              size={13}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="footnote" themeColor="textSecondary">
              Socials — hidden until you accept a chat
            </ThemedText>
          </View>
          {handles.length > 0 ? (
            handles.map((row) => (
              <ThemedText key={row.id} type="callout">
                {row.platform} · @{row.handle}
              </ThemedText>
            ))
          ) : (
            <ThemedText type="callout" themeColor="textSecondary">
              None added yet.
            </ThemedText>
          )}
        </ThemedView>

        <View style={styles.actions}>
          <PrimaryButton label="Edit profile" onPress={() => router.push('/edit-profile')} />
          {!profile?.verified ? (
            <PrimaryButton
              variant="ghost"
              label={verification?.status === 'pending' ? 'Verification in review' : 'Get verified'}
              onPress={() => router.push('/verification')}
            />
          ) : null}
          <PrimaryButton
            variant="ghost"
            label="Guidelines & support"
            onPress={() => router.push('/guidelines')}
          />
          <PrimaryButton
            variant="ghost"
            label="Sign out"
            onPress={() => {
              signOut().catch(() => Alert.alert('Sign out failed', 'Please try again.'));
            }}
          />
          {/* App Review 5.1.1(v): account deletion must be available in-app. */}
          <PrimaryButton
            variant="danger"
            label="Delete account"
            onPress={() => {
              Alert.alert(
                'Delete your account?',
                'This permanently removes your profile, photos, trips, pins, and chats (for both sides). It cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete forever',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await deleteAccount();
                      } catch {
                        Alert.alert('Deletion failed', 'Check your connection and try again.');
                        return;
                      }
                      // The auth user no longer exists; clear the local session.
                      signOut().catch(() => {});
                    },
                  },
                ]
              );
            }}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  // A native header already covers the safe area on this screen, so the top
  // inset must not be added a second time.
  content: {
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    paddingBottom: Space.xxxl,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  chip: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  section: {
    gap: Space.sm,
  },
  gallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  galleryPhoto: {
    width: '48%',
    aspectRatio: 4 / 5,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  slot: {
    borderWidth: StyleSheet.hairlineWidth * 3,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialCard: {
    gap: Space.xs,
    padding: Space.lg,
    borderRadius: Radius.lg,
  },
  socialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  actions: {
    gap: Space.sm,
  },
});
