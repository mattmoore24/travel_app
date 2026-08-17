import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ProfileHero } from '@/components/ui/profile-hero';
import { LANGUAGES } from '@/constants/languages';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { useBlockUser } from '@/features/chat/hooks';
import { usePhotoUrl, usePublicPhotos, usePublicProfile } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';

const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.value, l.label])
);

function GalleryPhoto({ path }: { path: string }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(path);
  return (
    <View style={[styles.galleryPhoto, { backgroundColor: theme.surfaceSunken }]}>
      {url ? <Image source={{ uri: url }} style={styles.fill} contentFit="cover" /> : null}
    </View>
  );
}

/**
 * Another traveler's full profile — everything RLS lets a stranger see, which
 * is exactly what the accept/decline and say-hi decisions should be based on
 * (brief Surface B: "the recipient sees the message and the sender's
 * profile"). Socials are structurally absent pre-accept.
 */
export default function PublicProfileScreen() {
  const theme = useTheme();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const profileQuery = usePublicProfile(userId ?? null);
  const { data: photos = [] } = usePublicPhotos(userId ?? null);
  const block = useBlockUser();
  const profile = profileQuery.data;

  if (profileQuery.isSuccess && !profile) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.container}>
          <ThemedText themeColor="textSecondary" style={styles.centerNote}>
            This traveler isn&apos;t available.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }
  if (!profile) {
    return <ThemedView style={styles.root} />;
  }

  const mainPhoto = photos.find((p) => p.position === 0) ?? photos[0] ?? null;
  const gallery = photos.filter((p) => p.id !== mainPhoto?.id);
  const home = [profile.home_city, profile.home_country].filter(Boolean).join(', ');

  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ProfileHero
          storagePath={mainPhoto?.storage_path ?? null}
          name={profile.display_name ?? 'Traveler'}
          age={profile.age ?? null}
          verified={profile.verified}
          subtitle={home ? `From ${home}` : null}
        />

        {profile.bio ? <ThemedText type="body">{profile.bio}</ThemedText> : null}

        {profile.languages.length > 0 ? (
          <View style={styles.chipWrap}>
            {profile.languages.map((code) => (
              <ThemedView key={code} type="surfaceSunken" style={styles.chip}>
                <ThemedText type="footnote">{LANGUAGE_LABELS[code] ?? code}</ThemedText>
              </ThemedView>
            ))}
          </View>
        ) : null}

        {gallery.length > 0 ? (
          <View style={styles.gallery}>
            {gallery.map((photo) => (
              <GalleryPhoto key={photo.id} path={photo.storage_path} />
            ))}
          </View>
        ) : null}

        <ThemedView type="surfaceSunken" style={styles.lockedCard}>
          <SymbolView
            name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }}
            size={13}
            tintColor={theme.textSecondary}
          />
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.lockedText}>
            Social handles stay hidden until you both accept a chat.
          </ThemedText>
        </ThemedView>

        <View style={styles.safetyRow}>
          <View style={styles.safetyButton}>
            <PrimaryButton
              variant="ghost"
              label="Report"
              onPress={() =>
                router.push({ pathname: '/report', params: { userId, context: 'profile' } })
              }
            />
          </View>
          <View style={styles.safetyButton}>
            <PrimaryButton
              variant="danger"
              label="Block"
              onPress={() =>
                Alert.alert(
                  `Block ${profile.display_name ?? 'this traveler'}?`,
                  'They disappear from your map and matches and can never message you. They are not told.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Block',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await block.mutateAsync(userId!);
                          router.back();
                        } catch {
                          // Surfaced by the global mutation error alert.
                        }
                      },
                    },
                  ]
                )
              }
            />
          </View>
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
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  centerNote: {
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  // A native header already covers the safe area on this screen.
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
  lockedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radius.lg,
  },
  lockedText: {
    flex: 1,
  },
  safetyRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  safetyButton: {
    flex: 1,
  },
});
