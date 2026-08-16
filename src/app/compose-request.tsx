import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSendRequest } from '@/features/matching/hooks';
import { usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';

const MESSAGE_MAX = 500;

// Hinge-style: the first message is anchored to something specific on the
// recipient's profile, and it clears moderation before it can be delivered.
const ELEMENT_OPTIONS = [
  { value: 'bio', label: 'Their bio' },
  { value: 'photo:0', label: 'A photo' },
  { value: 'languages', label: 'Languages' },
  { value: 'home', label: 'Where they are from' },
] as const;

export default function ComposeRequestScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    userId: string;
    name: string;
    photoPath: string;
    source?: string;
    element?: string;
  }>();
  const { data: photoUrl } = usePhotoUrl(params.photoPath || null);
  const sendRequest = useSendRequest();

  const source = params.source === 'pin' ? ('pin' as const) : ('trip_match' as const);
  const [element, setElement] = useState<string>(params.element ?? 'bio');
  const [message, setMessage] = useState('');
  const [blockedNotice, setBlockedNotice] = useState(false);

  const submit = async () => {
    if (!params.userId || message.trim().length === 0) {
      return;
    }
    setBlockedNotice(false);
    try {
      const result = await sendRequest.mutateAsync({
        recipientId: params.userId,
        source,
        firstMessage: message.trim(),
        profileElement: element,
      });
      if (result.blocked) {
        setBlockedNotice(true);
        return;
      }
      router.back();
    } catch {
      // Surfaced by the global mutation error alert; stay on the composer.
    }
  };

  return (
    <StepScreen
      title={`Say hi to ${params.name ?? 'this traveler'}`}
      subtitle="They'll see your message and profile, and choose whether to accept. One request per traveler."
      continueLabel="Send request"
      continueDisabled={message.trim().length === 0 || message.length > MESSAGE_MAX}
      continueLoading={sendRequest.isPending}
      onContinue={submit}>
      <View style={styles.recipientRow}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.avatarImage} contentFit="cover" />
          ) : null}
        </View>
        <ThemedText type="smallBold">{params.name ?? 'Traveler'}</ThemedText>
      </View>

      {source === 'pin' ? (
        <ThemedText type="small" themeColor="textSecondary">
          About their pin{params.element ? `: ${params.element.replace(/^pin:/, '')}` : ''}
        </ThemedText>
      ) : (
        <>
          <ThemedText type="smallBold">What are you replying to?</ThemedText>
          <ChipRow
            options={ELEMENT_OPTIONS}
            selected={[element]}
            onToggle={(value) => setElement(value)}
          />
        </>
      )}

      <FormTextField
        label="Your message"
        multiline
        numberOfLines={4}
        style={styles.messageInput}
        placeholder="Keep it friendly and specific — this is not a dating app."
        value={message}
        onChangeText={setMessage}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {message.length}/{MESSAGE_MAX}
      </ThemedText>

      {blockedNotice ? (
        <ThemedView type="backgroundElement" style={styles.blockedCard}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            That message can&apos;t be sent
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            It reads as flirtatious or explicit, which isn&apos;t what this app is for. Rewrite it
            and try again — repeated attempts get accounts suspended.
          </ThemedText>
        </ThemedView>
      ) : null}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  messageInput: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  blockedCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
});
