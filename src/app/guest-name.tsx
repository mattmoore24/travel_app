import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { renameGuest, signInAsGuest } from '@/features/auth/api';
import { useIsGuestAccount } from '@/features/guest/hooks';
import { useOwnProfile } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';
import { saveFailureMessage } from '@/lib/failure-message';
import { haptics } from '@/lib/haptics';

const NAME_MAX = 50;

/**
 * The whole of becoming a guest: type a name.
 *
 * One screen for both jobs, because they are the same question asked twice.
 * With no session it creates one (anonymous sign-in, then the name); with a
 * guest session it renames. Two screens would have been two copies of the
 * same field and the same validation.
 *
 * There is deliberately no mention of email, no password and no skip. A
 * guest who wants more is offered an account from their profile, and that
 * path keeps everything they did here because it is the same auth row.
 */
export default function GuestNameScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const isGuestAccount = useIsGuestAccount();
  const { data: profile } = useOwnProfile();

  const [name, setName] = useState(isGuestAccount ? (profile?.display_name ?? '') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const ok = trimmed.length > 0 && trimmed.length <= NAME_MAX;

  const submit = async () => {
    if (!ok || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isGuestAccount) {
        await renameGuest(trimmed);
      } else {
        await signInAsGuest(trimmed);
        analytics.capture('guest_joined');
      }
      haptics.success();
      // replace, not push: nobody should be able to swipe back into naming
      // themselves after they have a name.
      if (next) {
        router.replace(next as never);
      } else {
        router.back();
      }
    } catch (e) {
      setError(saveFailureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScreen
      title={isGuestAccount ? 'Change your name' : 'What should we call you?'}
      subtitle={
        isGuestAccount
          ? 'This is the name everyone in your chats sees.'
          : 'Just a name is enough to join in. No email, no password.'
      }
      continueLabel={isGuestAccount ? 'Save' : 'Join the chat'}
      continueDisabled={!ok}
      continueLoading={busy}
      onContinue={submit}>
      <FormTextField
        label="Name"
        testID="guest-name-input"
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        placeholder="Sam"
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX}
      />
      {error ? (
        <ThemedText type="footnote" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
      {!isGuestAccount ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          You can chat and that is it. Pins, trips and meeting new travelers need a profile, and you
          can make one later without losing this chat.
        </ThemedText>
      ) : null}
    </StepScreen>
  );
}
