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
      // Back first, ALWAYS. This screen is pushed on top of whatever asked
      // for a name — usually an invite — and that screen is still mounted
      // underneath, so going back reveals it re-rendered with a session on
      // it. `router.replace(next)` instead pushed a SECOND copy of the invite
      // over the first, which is why there was no way back to the other
      // option once you had picked one: the screen you wanted was two
      // dismissals down, behind a stack the app had built by hand.
      //
      // Signing in as a guest does not unmount the navigator (a guest needs
      // no profile lookup, so the root's readiness hold never goes up — see
      // features/auth/routing), so the pending back is safe to dispatch.
      //
      // `next` survives as the fallback for the one case back cannot serve:
      // a cold start that opened straight onto this screen.
      if (router.canGoBack()) {
        router.back();
      } else if (next) {
        router.replace(next as never);
      } else {
        router.replace('/(tabs)');
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
      // A visible way to change your mind. This is one of two doors on an
      // invite — a name, or a profile — and taking the wrong one left people
      // with no marked exit and a swipe-down gesture nothing on the screen
      // mentions. Backing out here lands on the invite again, both doors
      // still on it.
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
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
