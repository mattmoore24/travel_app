import { useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Space } from '@/constants/theme';
import { setNewPassword, signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { GENERIC_SAVE_FAILURE, saveFailureMessage } from '@/lib/failure-message';
import { haptics } from '@/lib/haptics';

const PASSWORD_MIN = 8;

/**
 * The end of a password recovery: set the new one, and you are in.
 *
 * Rendered by the root instead of the whole app rather than pushed on top of
 * it, because the recovery link signs you in — anything less would drop
 * somebody into the tabs with the old password still live on the account,
 * having taken them through an email round trip for nothing.
 */
export function ResetPasswordScreen() {
  const recovery = useAuthStore((s) => s.recovery);
  const endRecovery = useAuthStore((s) => s.endRecovery);
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ok = password.length >= PASSWORD_MIN;

  const submit = async () => {
    setTouched(true);
    if (!ok || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setNewPassword(password);
      haptics.success();
      // Straight into the app: the session the link established is now a
      // normal one, and the guards take it from here.
      endRecovery();
    } catch (e) {
      // saveFailureMessage answers for anything with a real sentence behind
      // it (Supabase auth writes those). Two failures it cannot know are this
      // screen's own: a lapsed recovery session surfaces as auth-js's
      // AuthSessionMissingError, whose 'Auth session missing!' is
      // capitalised-and-terminated and would pass through verbatim; and an
      // expired link falls to the generic. Both get the useful sentence.
      const sessionGone =
        (e as { name?: string })?.name === 'AuthSessionMissingError' ||
        /session missing/i.test((e as { message?: string })?.message ?? '');
      const message = saveFailureMessage(e);
      setError(
        sessionGone || message === GENERIC_SAVE_FAILURE
          ? 'Could not save that. The link may have expired, so ask for a new one.'
          : message
      );
    } finally {
      setSaving(false);
    }
  };

  const giveUp = () => {
    endRecovery();
    // The recovery link signed this session in; leaving it live would be a
    // back door for anyone holding the email.
    signOut().catch(() => {});
  };

  // Turning the link's tokens into a session is a round trip. Holding here
  // rather than reading "no session yet" as a dead link is what stops a
  // perfectly good link from flashing an expiry notice.
  if (recovery?.status === 'establishing') {
    return (
      <ThemedView style={styles.hold}>
        <ActivityIndicator />
        <ThemedText themeColor="textSecondary">Checking that link.</ThemedText>
      </ThemedView>
    );
  }

  if (recovery?.status === 'failed') {
    return (
      <StepScreen
        title="That link has expired"
        subtitle={recovery?.message ?? 'Ask for a new one and open it within the hour.'}
        continueLabel="Back to sign in"
        onContinue={giveUp}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Recovery links are good for one hour and one use, which is what stops an old email in
          somebody else&apos;s inbox from being a way in.
        </ThemedText>
      </StepScreen>
    );
  }

  return (
    <StepScreen
      title="Set a new password"
      subtitle="Eight characters or more."
      continueLabel="Save and sign in"
      continueDisabled={!ok}
      continueLoading={saving}
      onContinue={submit}
      footer={<PrimaryButton variant="ghost" label="Cancel" onPress={giveUp} />}>
      <FormTextField
        label="New password"
        testID="new-password-input"
        autoFocus
        secureTextEntry
        revealToggle
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setError(null);
        }}
        onSubmitEditing={submit}
        hint={`At least ${PASSWORD_MIN} characters.`}
        error={error ?? (touched && !ok ? `At least ${PASSWORD_MIN} characters.` : null)}
      />
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
        Saving this signs you in on this device and leaves you signed out everywhere else.
      </ThemedText>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  note: {
    paddingTop: Space.xs,
  },
  hold: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.md,
  },
});
