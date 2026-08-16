import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { LANGUAGES } from '@/constants/languages';
import { signOut } from '@/features/auth/api';
import {
  useOwnPhotos,
  useOwnProfile,
  useOwnSocialHandles,
  usePhotoUrl,
} from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/supabase';

const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.value, l.label])
);

function Avatar({ storagePath }: { storagePath: string | null }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(storagePath);
  return (
    <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
      {url ? (
        <Image source={{ uri: url }} style={styles.avatarImage} contentFit="cover" />
      ) : (
        <SymbolView
          name={{ ios: 'person.crop.circle', android: 'person', web: 'person' }}
          size={48}
          tintColor={theme.textSecondary}
        />
      )}
    </View>
  );
}

function GalleryPhoto({ storagePath }: { storagePath: string }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(storagePath);
  return (
    <View style={[styles.galleryPhoto, { backgroundColor: theme.backgroundElement }]}>
      {url ? <Image source={{ uri: url }} style={styles.avatarImage} contentFit="cover" /> : null}
    </View>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: profile } = useOwnProfile();
  const { data: photos = [] } = useOwnPhotos();
  const { data: handles = [] } = useOwnSocialHandles();

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

  return (
    <ThemedView style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: BottomTabInset + Spacing.six },
        ]}>
        <View style={styles.header}>
          <Avatar storagePath={mainPhoto?.storage_path ?? null} />
          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <ThemedText type="subtitle">
                {profile?.display_name ?? '—'}
                {profile?.age != null ? `, ${profile.age}` : ''}
              </ThemedText>
              {profile?.verified ? (
                <SymbolView
                  name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
                  size={20}
                  tintColor={theme.tint}
                />
              ) : null}
            </View>
            {profile?.home_city || profile?.home_country ? (
              <ThemedText themeColor="textSecondary">
                {[profile.home_city, profile.home_country].filter(Boolean).join(', ')}
              </ThemedText>
            ) : null}
          </View>
        </View>

        {profile?.languages.length ? (
          <View style={styles.chipWrap}>
            {profile.languages.map((code) => (
              <ThemedView key={code} type="backgroundElement" style={styles.langChip}>
                <ThemedText type="small">{LANGUAGE_LABELS[code] ?? code}</ThemedText>
              </ThemedView>
            ))}
          </View>
        ) : null}

        {profile?.bio ? <ThemedText>{profile.bio}</ThemedText> : null}

        {gallery.length > 0 ? (
          <View style={styles.gallery}>
            {gallery.map((photo) => (
              <GalleryPhoto key={photo.id} storagePath={photo.storage_path} />
            ))}
          </View>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.socialCard}>
          <View style={styles.socialHeader}>
            <SymbolView
              name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }}
              size={14}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="smallBold">Socials — hidden until you accept a chat</ThemedText>
          </View>
          {handles.length > 0 ? (
            handles.map((row) => (
              <ThemedText key={row.id} type="small" themeColor="textSecondary">
                {row.platform} · @{row.handle}
              </ThemedText>
            ))
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              None added yet.
            </ThemedText>
          )}
        </ThemedView>

        <View style={styles.actions}>
          <PrimaryButton label="Edit profile" onPress={() => router.push('/edit-profile')} />
          <PrimaryButton
            variant="danger"
            label="Sign out"
            onPress={() => {
              signOut().catch(() => Alert.alert('Sign out failed', 'Please try again.'));
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
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerText: {
    flex: 1,
    gap: Spacing.one,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  langChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  gallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  galleryPhoto: {
    width: '48.5%',
    aspectRatio: 4 / 5,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  socialCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  socialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
});
