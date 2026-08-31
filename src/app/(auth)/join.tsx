import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { signUpWithEmail, upgradeGuestToAccount } from '@/features/auth/api';
import { AppleSignInButton, useAppleSignInAvailable } from '@/features/auth/apple-button';
import { ConsentNote } from '@/features/auth/consent-note';
import { AccountKindChoice, type AccountKind } from '@/features/auth/account-kind';
import { useRecordListingIntent } from '@/features/business/hooks';
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
  const theme = useTheme();
  const isGuestAccount = useIsGuestAccount();
  const appleAvailable = useAppleSignInAvailable();
  const listingStarted = useAuthStore((s) => s.listingStarted);
  const listingDone = useAuthStore((s) => s.listingDone);
  const recordListingIntent = useRecordListingIntent();

  // In-memory ONLY. The durable flag is written when the account is actually
  // committed, never on a selection tap, and the difference is a real bug:
  // a guest HAS a session, so a durable write from here succeeds. Somebody
  // browsing as a guest who taps "A business" out of curiosity, backs out,
  // comes back later and signs up as a traveller never taps the traveller
  // row again (it is the default), so nothing ever takes the flag down — and
  // a brand-new traveller account with wants_business true is read as
  // already-onboarded and never gets onboarding at all, landing on the tabs
  // with an empty profile and every editor missing from the navigator.
  //
  // The Apple path, which never reaches submitPassword, is covered where it
  // actually belongs: business-signup writes the flag on mount.
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

  // The denominator for the largest drop-off in the product: arriving here
  // and leaving without touching anything. Once, on arrival — the ref rather
  // than an empty dep array so the lint rule is satisfied without the event
  // re-firing when the kind rows flip `forBusiness`.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    analytics.capture('signup_started', { business: forBusiness });
  }, [forBusiness]);

  const submitEmail = () => {
    setTouched(true);
    if (!emailOk) {
      return;
    }
    haptics.light();
    setTouched(false);
    analytics.capture('signup_step_completed', { step_index: 1, step_name: 'email' });
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
      analytics.capture('signup_step_completed', {
        step_index: 2,
        step_name: 'password',
        business: forBusiness,
      });
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
      // The durable half of the same answer, written at COMMIT and for both
      // branches. Awaited, because this is the write that has to survive the
      // app being killed on step 7 of a form whose steps 4 to 11 had no exit
      // at all. Both branches, because a false written here is what corrects
      // an account that touched the business row earlier and changed its
      // mind. recordListingIntent seeds the query cache the router gates on,
      // so the read that fires from inside signUpWithEmail cannot win the
      // race with a stale false.
      await recordListingIntent(forBusiness).catch(() => {});
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
        // A statement, not "What is your email?". The old question was
        // answered by a full-width Apple pill that skips the email entirely,
        // so the heading contradicted its own loudest action. "Make your
        // account" covers all three things on this screen: the account-kind
        // rows, the Apple button and the email field.
        title="Make your account"
        // Founder's words, both of them. The old pair told people what the
        // email is NOT for, which invites the question, and the business one
        // promised a second email nobody had asked about yet. These say the
        // thing somebody actually wants to know: nobody sees it, and — for a
        // business, whose whole point is being reachable — where the number
        // travelers will actually call goes instead. "Travelers", not
        // "customers": one word for the people on the other side, everywhere.
        subtitle={
          forBusiness
            ? 'This email is just for signing in. You will enter your contact information where travelers can reach you when you build your listing.'
            : 'Your email is never shown to other users.'
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
        {/* Apple and the email field are ALTERNATIVES, and stacked with
            nothing between them they read as a sequence — tap the pill, then
            fill in the field. Only while the pill actually rendered: a
            divider with nothing above it is a stray line. */}
        {!isGuestAccount && appleAvailable ? (
          <View style={styles.orRow}>
            <View style={[styles.orLine, { backgroundColor: theme.hairline }]} />
            <ThemedText type="footnote" themeColor="textSecondary">
              or
            </ThemedText>
            <View style={[styles.orLine, { backgroundColor: theme.hairline }]} />
          </View>
        ) : null}
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
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingBottom: Space.sm,
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  footer: {
    gap: Space.md,
  },
});
