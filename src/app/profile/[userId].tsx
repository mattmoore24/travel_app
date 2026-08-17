import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LANGUAGES } from '@/constants/languages';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useBlockUser } from '@/features/chat/hooks';
import { usePhotoUrl, usePublicPhotos, usePublicProfile } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';

const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.value, l.label])
);

function Photo({ path, style }: { path: string; style: object }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(path);
  return (
    <View style={[style, { backgroundColor: theme.backgroundElement }]}>
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

  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {mainPhoto ? <Photo path={mainPhoto.storage_path} style={styles.mainPhoto} /> : null}

        <View style={styles.nameRow}>
          <ThemedText type="subtitle">
            {profile.display_name ?? 'Traveler'}
            {profile.age != null ? `, ${profile.age}` : ''}
          </ThemedText>
          {profile.verified ? (
            <SymbolView
              name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
              size={20}
              tintColor={theme.tint}
            />
          ) : null}
        </View>

        {profile.home_city || profile.home_country ? (
          <ThemedText themeColor="textSecondary">
            From {[profile.home_city, profile.home_country].filter(Boolean).join(', ')}
          </ThemedText>
        ) : null}

        {profile.languages.length > 0 ? (
          <View style={styles.chipWrap}>
            {profile.languages.map((code) => (
              <ThemedView key={code} type="backgroundElement" style={styles.langChip}>
                <ThemedText type="small">{LANGUAGE_LABELS[code] ?? code}</ThemedText>
              </ThemedView>
            ))}
          </View>
        ) : null}

        {profile.bio ? <ThemedText>{profile.bio}</ThemedText> : null}

        {gallery.length > 0 ? (
          <View style={styles.gallery}>
            {gallery.map((photo) => (
              <Photo key={photo.id} path={photo.storage_path} style={styles.galleryPhoto} />
            ))}
          </View>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.lockedCard}>
          <SymbolView
            name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }}
            size={14}
            tintColor={theme.textSecondary}
          />
          <ThemedText type="small" themeColor="textSecondary">
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
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  mainPhoto: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
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
  lockedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  safetyRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  safetyButton: {
    flex: 1,
  },
});
