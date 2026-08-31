import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, type TextInput } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { changeEmail, changePassword } from '@/features/auth/api';
import {
  credentialsFailure,
  credentialsProblem,
  emailChangeProblem,
  PASSWORD_MIN,
} from '@/features/auth/credentials';
import { useAuthStore } from '@/features/auth/store';
import { haptics } from '@/lib/haptics';

/**
 * Change the password, and change the address, without giving up the session.
 *
 * Before this the only route to a password change was "Forgot your password?"
 * on the SIGNED OUT screen, so a traveler whose phone was taken had to sign
 * out, remember which address she had used, leave for a mail app on hostel
 * wifi and come back through a deep link. There was no route to an email
 * change at all, which made losing an inbox the same as losing the account.
 *
 * Four views rather than two forms on one page: StepScreen has one primary
 * action, and the rule in `traps` is that a submit button lives OUTSIDE the
 * scroll area. Two submits on one screen would put one of them inside it.
 */
type View = 'password' | 'password-done' | 'email' | 'email-sent';

export default function AccountCredentialsScreen() {
  const session = useAuthStore((s) => s.session);
  const address = session?.user.email ?? null;
  // GoTrue keeps the address the person is moving TO here until the link is
  // opened, which is the only honest way to draw a change that is already in
  // flight when this screen opens.
  const awaiting = session?.user.new_email ?? null;
  const provider =
    typeof session?.user.app_metadata?.provider === 'string'
      ? session.user.app_metadata.provider
      : undefined;
  const signsInWithApple = provider === 'apple';

  const [view, setView] = useState<View>('password');
  // Whether the scope:'others' revoke actually landed. The done view states a
  // security fact, so it may only state the one that happened.
  const [othersSignedOut, setOthersSignedOut] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const nextField = useRef<TextInput>(null);

  const close = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  const passwordProblem = credentialsProblem({ current, next, provider });
  const addressProblem = emailChangeProblem(newAddress, address);

  const savePassword = async () => {
    setTouched(true);
    if (passwordProblem != null || saving) {
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { othersSignedOut: revoked } = await changePassword(current, next);
      setOthersSignedOut(revoked);
      haptics.success();
      setCurrent('');
      setNext('');
      setTouched(false);
      setView('password-done');
    } catch (e) {
      setError(credentialsFailure(e));
    } finally {
      setSaving(false);
    }
  };

  const sendEmailLink = async () => {
    setTouched(true);
    if (addressProblem != null || saving) {
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const target = newAddress.trim();
      await changeEmail(target);
      haptics.success();
      setSentTo(target);
      setTouched(false);
      setView('email-sent');
    } catch (e) {
      setError(credentialsFailure(e));
    } finally {
      setSaving(false);
    }
  };

  if (view === 'password-done') {
    return (
      <StepScreen
        title="Password changed"
        subtitle="Use the new one next time you sign in."
        continueLabel="Done"
        onContinue={close}>
        <ThemedText type="footnote" themeColor="textSecondary">
          {othersSignedOut
            ? 'Every other device signed in on this account has been signed out. This one stays signed in.'
            : 'We could not reach your other devices to sign them out. Use Sign out on all devices from your profile.'}
        </ThemedText>
      </StepScreen>
    );
  }

  if (view === 'email-sent') {
    return (
      <StepScreen
        title="Check your inbox"
        subtitle={`We sent a link to ${sentTo ?? newAddress.trim()}. Open it to finish the change.`}
        continueLabel="Done"
        onContinue={close}
        footer={
          <PrimaryButton
            variant="ghost"
            label="Use a different address"
            onPress={() => {
              setSentTo(null);
              setView('email');
            }}
          />
        }>
        {/* Two sentences, both of which are true whether or not the project
            has "Secure email change" switched on. Promising a link at each
            address would be asserting a setting this code does not control,
            which is the mistake the reset screen already made once about
            other sessions. */}
        <ThemedText type="footnote" themeColor="textSecondary">
          {address != null
            ? `A link may also land at ${address}. Open that one too if it arrives.`
            : 'A link may also land at your current address. Open that one too if it arrives.'}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
          {address != null
            ? `Until the change is finished, keep signing in with ${address}.`
            : 'Until the change is finished, keep signing in with your current address.'}
        </ThemedText>
      </StepScreen>
    );
  }

  if (view === 'email') {
    return (
      <StepScreen
        title="Change your email"
        subtitle={
          address != null
            ? `You sign in with ${address} today. Your email is never shown to other travelers.`
            : 'Your email is never shown to other travelers.'
        }
        continueLabel="Send the link"
        continueDisabled={addressProblem != null}
        continueLoading={saving}
        onContinue={sendEmailLink}
        note={touched ? addressProblem : null}
        onClose={close}
        footer={
          <PrimaryButton
            variant="ghost"
            label="Back"
            onPress={() => {
              setError(null);
              setTouched(false);
              setView('password');
            }}
          />
        }>
        <FormTextField
          label="New email"
          testID="new-email-input"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="go"
          value={newAddress}
          onChangeText={(text) => {
            setNewAddress(text);
            setError(null);
          }}
          onSubmitEditing={sendEmailLink}
          error={error ?? (touched ? addressProblem : null)}
        />
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
          Nothing changes until you open the link we send.
        </ThemedText>
      </StepScreen>
    );
  }

  return (
    <StepScreen
      title="Email and password"
      subtitle={
        address != null
          ? `This account signs in with ${address}.`
          : 'This account has no email address on it yet.'
      }
      continueLabel="Save password"
      continueDisabled={passwordProblem != null}
      continueLoading={saving}
      onContinue={savePassword}
      note={signsInWithApple ? passwordProblem : touched ? passwordProblem : null}
      onClose={close}
      footer={
        <PrimaryButton
          variant="ghost"
          label="Change your email"
          onPress={() => {
            setError(null);
            setTouched(false);
            setView('email');
          }}
        />
      }>
      {awaiting != null ? (
        <ThemedText type="footnote" themeColor="warning">
          {`A change to ${awaiting} is waiting on the link we sent. Until you open it, ${address ?? 'your current address'} is still the one that signs you in.`}
        </ThemedText>
      ) : null}
      {signsInWithApple ? (
        // A form that cannot succeed is worse than a sentence. An account
        // made through Sign in with Apple has no password of ours at all.
        <ThemedText themeColor="textSecondary">
          You sign in with Apple, so there is no password here to change. Manage it under your Apple
          ID in Settings.
        </ThemedText>
      ) : (
        <>
          <FormTextField
            label="Current password"
            testID="current-password-input"
            secureTextEntry
            revealToggle
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="next"
            value={current}
            onChangeText={(text) => {
              setCurrent(text);
              setError(null);
            }}
            onSubmitEditing={() => nextField.current?.focus()}
            error={error}
          />
          <FormTextField
            label="New password"
            testID="new-password-input"
            inputRef={nextField}
            secureTextEntry
            revealToggle
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            value={next}
            onChangeText={(text) => {
              setNext(text);
              setError(null);
            }}
            onSubmitEditing={savePassword}
            hint={`At least ${PASSWORD_MIN} characters.`}
            error={
              touched && next.length > 0 && next.length < PASSWORD_MIN ? passwordProblem : null
            }
          />
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
            Saving signs you out on every other device, which is the point of doing it after a phone
            goes missing.
          </ThemedText>
        </>
      )}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  note: {
    paddingTop: Space.xs,
  },
});
