import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { signUpWithEmail, upgradeGuestToAccount } from '@/features/auth/api';
import { AppleSignInButton } from '@/features/auth/apple-button';
import { ConsentNote } from '@/features/auth/consent-note';
import { AccountKindChoice, type AccountKind } from '@/features/auth/account-kind';
import { useAuthStore } from '@/features/auth/store';
import { useIsGuestAccount } from '@/features/guest/hooks';
import { StepShell } from '@/features/signup/step-shell';
import { SIGNUP_TOTAL_STEPS } from '@/features/signup/steps';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

/**
 * The first two steps of making an account: one question per screen, same
 * chrome as the four profile steps that follow, so the whole thing reads as
 * one six-step sequence even though the account gets created in the middle
 * of it (that is what swaps the app from the auth stack to onboarding).
 */
export default function JoinScreen() {
  const isGuestAccount = useIsGuestAccount();
  const listingStarted = useAuthStore((s) => s.listingStarted);
  const listingDone = useAuthStore((s) => s.listingDone);

  // The flag follows the chooser rather than the submit, so the Apple button
  // carries the answer too. Signing in through Apple never reaches
  // `submitPassword`, and without this a place owner who took the one-tap
  // option landed in traveler onboarding just as before.
  const chooseKind = (next: AccountKind) => {
    setKind(next);
    if (next === 'business') {
      listingStarted();
    } else {
      listingDone();
    }
  };
  // Arriving from the "Run a business?" door on the welcome tour. Carried
  // through because register_business refuses an account that has finished
  // traveler onboarding, and onboarding is exactly where the root guard
  // drops somebody the moment they have a session — so without this, the one
  // person who came here to list their bar is four taps from permanently
  // locking themselves out of doing it.
  const { business } = useLocalSearchParams<{ business?: string }>();
  // The chooser below is the answer now; the link only sets what it opens on.
  const [kind, setKind] = useState<AccountKind>(business === '1' ? 'business' : 'traveler');
  const forBusiness = kind === 'business';
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [loading, setLoading] = useState(false);

  const emailOk = EMAIL_PATTERN.test(email.trim());
  const passwordOk = password.length >= PASSWORD_MIN;

  const submitEmail = () => {
    setTouched(true);
    if (!emailOk) {
      return;
    }
    haptics.light();
    setTouched(false);
    analytics.capture('signup_step_completed', { step: 'email' });
    setStep(2);
  };

  const submitPassword = async () => {
    setTouched(true);
    if (!passwordOk) {
      return;
    }
    setError(null);
    setTaken(false);
    setLoading(true);
    try {
      // A guest is already an auth user. Adding the email to THAT row keeps
      // the id, and with it every chat, membership and message they made
      // while they were a guest. signUpWithEmail would mint a second id and
      // strand all of it behind an account they can no longer reach.
      if (isGuestAccount) {
        await upgradeGuestToAccount(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
      }
      haptics.success();
      analytics.capture('signup_step_completed', { step: 'password', business: forBusiness });
      // The root guard swaps to the profile steps on the auth event. For a
      // place we jump straight past them: `business-signup` sits outside the
      // onboarded guard precisely so it can be reached by an account that
      // will never finish traveler onboarding.
      //
      // The flag as well as the replace, because the replace alone loses the
      // race about half the time: signing in raises the root's readiness hold,
      // the hold unmounts the navigator, and a queued navigation with nothing
      // mounted is dropped. Onboarding reads the flag and forwards. See
      // features/auth/store.
      if (forBusiness) {
        listingStarted();
        router.replace('/business-signup');
      }
    } catch (e) {
      const message = (e as Error).message ?? 'Something went wrong.';
      if (/already|registered|exists/i.test(message)) {
        setTaken(true);
        setError('That email already has an account.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (step === 1) {
    return (
      <StepShell
        step={1}
        total={SIGNUP_TOTAL_STEPS}
        title="What is your email?"
        subtitle={
          forBusiness
            ? 'Only for signing in. Your business gets its own email to confirm later.'
            : 'Only for signing in. No newsletters.'
        }
        continueLabel="Continue"
        continueDisabled={!emailOk}
        onContinue={submitEmail}
        onBack={router.canGoBack() ? () => router.back() : undefined}
        footer={
          <View style={styles.footer}>
            <ConsentNote />
            <PrimaryButton
              variant="ghost"
              label="I already have an account"
              onPress={() => router.push('/email')}
            />
          </View>
        }>
        {/* Apple first, because it is one tap and no password to invent, and
            because Apple requires it to be offered wherever a third-party
            sign-in is. It renders nothing where it is unavailable.

            Not for a GUEST, though. The email path calls
            `upgradeGuestToAccount`, which adds the address to the anonymous
            row and so keeps the id and every chat made under it.
            `signInWithIdToken` cannot do that — it mints a second user — and
            a guest who took the one-tap option would have walked away from
            the conversations this app promised would come with them. Apple's
            own rule is about offering it alongside OTHER third-party logins,
            and the only alternative here is first-party email, so leaving it
            out on this one screen is fine. */}
        {/* Before the field, not after it, and before Apple. Whoever is
            typing an address should already know which kind of account it is
            about to make. A guest is not offered the choice: they are
            upgrading an account that already exists, and it is a traveler's. */}
        {isGuestAccount ? null : <AccountKindChoice value={kind} onChange={chooseKind} />}
        {isGuestAccount ? null : (
          <View style={styles.appleRow}>
            <AppleSignInButton label="signup" />
          </View>
        )}
        <FormTextField
          label="Email"
          testID="email-input"
          // No autoFocus any more. There is a question above this field now,
          // and a keyboard that opens on arrival scrolls the field into view
          // and the question out of it, which is the whole thing this screen
          // was changed to show. The password step keeps its autoFocus: there
          // is nothing above it to read.
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          // Without this the single-line default blurAndSubmit tears the
          // keyboard down before submitEmail runs: on a good address it drops
          // and springs straight back for step 2's autofocused password, and
          // on a bad one it leaves the person reading "Check that address"
          // with no keyboard and a tap needed to get back into the field.
          submitBehavior="submit"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setTouched(false);
          }}
          onSubmitEditing={submitEmail}
          error={touched && !emailOk ? 'Check that address and try again.' : null}
        />
      </StepShell>
    );
  }

  return (
    <StepShell
      step={2}
      total={SIGNUP_TOTAL_STEPS}
      title="Pick a password"
      subtitle={
        forBusiness
          ? 'Eight characters or more. This is for your business account.'
          : 'Eight characters or more. This is for your traveler account.'
      }
      continueLabel="Create account"
      continueTestID="create-account"
      continueDisabled={!passwordOk}
      continueLoading={loading}
      // Submit-level failures belong here, not on a field. The commonest one
      // is "that email already has an account", which was turning the
      // password box red on a screen the email is not even on.
      note={error}
      onContinue={submitPassword}
      onBack={() => {
        setTouched(false);
        setError(null);
        setStep(1);
      }}
      footer={
        <View style={styles.footer}>
          <ConsentNote />
          {taken ? (
            <PrimaryButton
              variant="ghost"
              label="Sign in instead"
              onPress={() => router.push('/email')}
            />
          ) : null}
        </View>
      }>
      {/* ONE password field, not two. A confirm box asks people to type a
          string they cannot see, twice, and rejects them for a typo in the
          copy rather than the original — the eye does the same job by
          letting them read what they actually wrote. */}
      <FormTextField
        label="Password"
        testID="password-input"
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
        onSubmitEditing={submitPassword}
        hint={`At least ${PASSWORD_MIN} characters.`}
        error={touched && !passwordOk ? `At least ${PASSWORD_MIN} characters.` : null}
      />
      {passwordOk ? (
        <View style={styles.matchRow}>
          <ThemedText type="footnote" themeColor="textSecondary">
            {forBusiness
              ? 'That will do. Your listing is next.'
              : 'That will do. Your profile is next.'}
          </ThemedText>
        </View>
      ) : null}
    </StepShell>
  );
}

const styles = StyleSheet.create({
  matchRow: {
    paddingTop: Space.xs,
  },
  appleRow: {
    paddingBottom: Space.sm,
  },
  footer: {
    gap: Space.md,
  },
});
