import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useMyChats, useUnlockedSocialHandles } from '@/features/matching/hooks';
import { usePhotoUrl, useOwnUserId } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  x: 'X',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  other: 'Other',
};

// Chat shell: the accepted request's context, plus the social handles this
// accept just unlocked. Live realtime messaging lands in Phase 4.
export default function ChatShellScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ownUserId = useOwnUserId();
  const { data: chats = [] } = useMyChats();
  const chat = chats.find((c) => c.chat_id === id);
  const { data: photoUrl } = usePhotoUrl(chat?.other_photo_path ?? null);
  const { data: socials = [] } = useUnlockedSocialHandles(chat?.other_user_id ?? null);

  if (!chat) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.container}>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            Chat not found.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const firstMessageIsMine = chat.first_message_sender_id === ownUserId;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
              ) : (
                <SymbolView
                  name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                  size={28}
                  tintColor={theme.textSecondary}
                />
              )}
            </View>
            <ThemedText type="subtitle">{chat.other_display_name ?? 'Traveler'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              You matched — this conversation started from a message request.
            </ThemedText>
          </View>

          {chat.first_message ? (
            <View
              style={[
                styles.bubble,
                firstMessageIsMine ? styles.bubbleMine : styles.bubbleTheirs,
                {
                  backgroundColor: firstMessageIsMine ? theme.tint : theme.backgroundElement,
                },
              ]}>
              <ThemedText
                type="small"
                style={firstMessageIsMine ? { color: theme.onTint } : undefined}>
                {chat.first_message}
              </ThemedText>
            </View>
          ) : null}

          <ThemedView type="backgroundElement" style={styles.socialCard}>
            <View style={styles.socialHeader}>
              <SymbolView
                name={{ ios: 'lock.open.fill', android: 'lock_open', web: 'lock_open' }}
                size={14}
                tintColor={theme.tint}
              />
              <ThemedText type="smallBold">Socials unlocked</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Accepting a chat is the only thing that reveals social handles — both ways.
            </ThemedText>
            {socials.length > 0 ? (
              socials.map((handle) => (
                <ThemedText key={handle.id} type="small">
                  {PLATFORM_LABELS[handle.platform] ?? handle.platform} · @{handle.handle}
                </ThemedText>
              ))
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                They haven&apos;t added any handles yet.
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.phaseNote}>
            <ThemedText type="code">live messaging arrives in phase 4</ThemedText>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
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
    maxWidth: MaxContentWidth,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  center: {
    textAlign: 'center',
    marginTop: Spacing.six,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  bubble: {
    maxWidth: '80%',
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: Spacing.one,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: Spacing.one,
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
  phaseNote: {
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
});
