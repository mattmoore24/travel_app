import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { useOpenDirectChat } from '@/features/groups/hooks';
import { haptics } from '@/lib/haptics';
import { saveFailureMessage } from '@/lib/failure-message';

const MESSAGE_MAX = 500;

/**
 * Messaging somebody you are already in a group with.
 *
 * Deliberately not compose-request. That screen is the say-hi gate: pick
 * what you are answering, watch a budget, send it, wait to be accepted. None
 * of that applies here — you two have been talking in a group all day, and
 * the founder's ask was that this be "as easy as clicking their profile icon
 * and sending them a chat". One field and Send, and you land in the chat.
 *
 * The first message is still screened before anything is created (§7 rule
 * 5). What is gone is the accept step, not the moderation.
 */
export default function MessageScreen() {
  const { userId, name } = useLocalSearchParams<{ userId: string; name?: string }>();
  const openChat = useOpenDirectChat();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const who = name?.trim() || 'them';

  const submit = async () => {
    if (!userId || message.trim().length === 0) {
      return;
    }
    setError(null);
    setBlocked(false);
    try {
      const result = await openChat.mutateAsync({ userId, firstMessage: message });
      if (result.blocked || !result.chatId) {
        setBlocked(true);
        return;
      }
      haptics.success();
      // replace, not push: this screen has done its job and going back to an
      // empty composer for a chat you are now inside reads as a bug.
      router.replace({ pathname: '/chat/[id]', params: { id: result.chatId } });
    } catch (e) {
      setError(saveFailureMessage(e));
    }
  };

  return (
    <StepScreen
      title={`Message ${who}`}
      subtitle="You are in a group together, so this goes straight through. No hello to be accepted."
      continueLabel="Send"
      continueDisabled={message.trim().length === 0}
      continueLoading={openChat.isPending}
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      onContinue={submit}>
      <FormTextField
        label="Message"
        testID="direct-message-input"
        autoFocus
        multiline
        numberOfLines={3}
        placeholder={`Hey ${who === 'them' ? '' : who}, `.trim()}
        value={message}
        onChangeText={setMessage}
        maxLength={MESSAGE_MAX}
      />
      {blocked ? (
        <ThemedText type="footnote" themeColor="danger">
          That one did not pass. Try saying it another way.
        </ThemedText>
      ) : null}
      {error ? (
        <ThemedText type="footnote" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
      <ThemedText type="footnote" themeColor="textSecondary">
        They can block you or leave any chat you share, any time. So can you.
      </ThemedText>
    </StepScreen>
  );
}
