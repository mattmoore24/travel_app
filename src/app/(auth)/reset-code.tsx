import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { Space, Type } from '@/constants/theme';
import { requestPasswordReset, verifyRecoveryCode } from '@/features/auth/api';
import {
  RECOVERY_CODE_LENGTH,
  RECOVERY_CODE_TTL_MS,
  recoveryCodeProblem,
  resendOutcome,
} from '@/features/auth/recovery';
import { useAuthStore } from '@/features/auth/store';
import { haptics } from '@/lib/haptics';

/**
 * Whether the code that was sent has run out, without reading the clock
 * during render. The timeout is set for the exact minute it dies, so a
 * screen left open flips its own copy instead of lying until the next tap.
 *
 * The twin of the hook inside app/business-email.tsx, with an hour where
 * that one has twenty minutes. Kept separate rather than exported from
 * there: a sign-in screen importing from the business signup would be the
 * wrong dependency direction, and the shared thing is fifteen lines.
 */
function useCodeExpired(sentAtMs: number): boolean {
  // Which code has run out, rather than a bare boolean: a resend gives a new
  // sentAt, which no longer matches, so the screen goes back to "check your
  // email" without anything having to reset it.
  const [expiredFor, setExpiredFor] = useState<number | null>(null);
  useEffect(() => {
    const left = sentAtMs + RECOVERY_CODE_TTL_MS - Date.now();
    const timer = setTimeout(() => setExpiredFor(sentAtMs), Math.max(left, 0));
    return () => clearTimeout(timer);
  }, [sentAtMs]);
  return expiredFor === sentAtMs;
}

/**
 * The six digits from a recovery mail, typed rather than tapped.
 *
 * Reached from "Forgot your password?" on /email, which has just asked
 * Supabase for the mail and hands the address and the moment over as params.
 * The mail's link still works beside this - `parseRecoveryLink` takes it on
 * the phone - but a link is what a laptop cannot open and a mail scanner can
 * spend before the person sees it (features/auth/api, requestPasswordReset),
 * and a code is neither. Accepting the code establishes the recovery session
 * and hands over to `ResetPasswordScreen`, exactly where the link lands.
 *
 * Modelled on app/business-email.tsx, which is the same screen for a
 * business's listing code, down to the number-pad field and the honest clock
 * on "we sent it". What it deliberately does not have is a way to change the
 * address here: a form that took an address AND a code is a second place
 * to probe which addresses have accounts, and the sign-in screen is one tap
 * back.
 */
export default function ResetCodeScreen() {
  const params = useLocalSearchParams<{ email?: string; sentAt?: string }>();
  const email = params.email?.trim() ?? '';
  const recoveryReady = useAuthStore((s) => s.recoveryReady);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [echo, setEcho] = useState<string | null>(null);
  // When the mail went, from the screen that asked for it; now, when nothing
  // said. The hour the copy promises is counted from here.
  const [sentAt, setSentAt] = useState<number>(() => {
    const handed = Number(params.sentAt);
    return Number.isFinite(handed) && handed > 0 ? handed : Date.now();
  });
  const expired = useCodeExpired(sentAt);

  if (email.length === 0) {
    // Nothing to check a code against. Somebody arrived here without going
    // through the sign-in screen, which is the only door that knows the
    // address; send them to it rather than draw a box that can never work.
    return <Redirect href="/email" />;
  }

  const ready = code.length === RECOVERY_CODE_LENGTH;

  const submit = async () => {
    if (!ready || checking) {
      return;
    }
    setChecking(true);
    setError(null);
    try {
      await verifyRecoveryCode(email, code);
      haptics.success();
      // The auth listener has already done this on PASSWORD_RECOVERY, in the
      // same tick the session landed; saying it again is free and is what
      // keeps the person out of the tabs should that event ever not fire.
      recoveryReady();
    } catch (e) {
      haptics.error();
      setError(recoveryCodeProblem(e));
      // The next attempt is six fresh digits rather than an edit of these.
      setCode('');
    } finally {
      setChecking(false);
    }
  };

  const sendAgain = async () => {
    if (resending) {
      return;
    }
    setResending(true);
    setEcho(null);
    let outcome: ReturnType<typeof resendOutcome> = 'sent';
    try {
      await requestPasswordReset(email);
    } catch (e) {
      // Silent on "no such account" for the same reason the sign-in screen
      // is: naming it would be an account-existence oracle.
      outcome = resendOutcome(e);
    } finally {
      setResending(false);
    }
    if (outcome === 'sent') {
      haptics.success();
      setSentAt(Date.now());
      setCode('');
      setError(null);
      setEcho('Sent. Give it a minute to turn up.');
    } else if (outcome === 'wait') {
      setEcho('One is already on its way. Give it a minute before asking for another.');
    } else {
      setEcho('No connection. Sending a code needs the internet.');
    }
  };

  return (
    <StepScreen
      title={expired ? 'That code has run out' : 'Check your email'}
      subtitle={
        expired
          ? `The code we sent to ${email} has run out. Send yourself a fresh one.`
          : `We sent a six-digit code to ${email}. It is good for an hour.`
      }
      continueLabel="Use this code"
      continueDisabled={!ready}
      continueLoading={checking}
      note={ready ? null : 'Six digits, from the email.'}
      onContinue={submit}
      footer={
        <>
          <PrimaryButton
            // It leads once the code has run out: an empty six-digit box under
            // a ghost button is the wrong shape for a screen whose only next
            // step is a new code.
            variant={expired ? 'filled' : 'ghost'}
            label="Send it again"
            accessibilityLabel="Send the code again"
            loading={resending}
            onPress={sendAgain}
          />
          {echo ? (
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.centered}>
              {echo}
            </ThemedText>
          ) : null}
          {/* The mail template decides whether the mail carries a code or a
              link (docs/SUPABASE_SETUP.md §5). Until the founder has made
              that edit, and for any mail sent before it, this line is the
              whole answer to a screen asking for digits the mail does not
              have. */}
          <ThemedText type="footnote" themeColor="textSecondary">
            Got a link and no code? Open the email on the phone that has Samewhere on it and tap the
            link. It brings you straight here.
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Nothing yet? Check your spam, and check the address above.
          </ThemedText>
          <PrimaryButton
            variant="ghost"
            label="Not that address? Go back"
            accessibilityLabel="Go back and use a different address"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/email'))}
          />
        </>
      }>
      <FormTextField
        label="Code"
        testID="reset-code-input"
        accessibilityLabel="Six-digit code"
        autoFocus
        keyboardType="number-pad"
        maxLength={RECOVERY_CODE_LENGTH}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        // Paste from a mail app arrives with whatever was around it.
        onChangeText={(next) => {
          setCode(next.replace(/\D/g, '').slice(0, RECOVERY_CODE_LENGTH));
          setError(null);
        }}
        onSubmitEditing={submit}
        error={error}
        style={styles.code}
      />
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  code: {
    fontSize: Type.title.fontSize,
    letterSpacing: 8,
    textAlign: 'center',
  },
  centered: {
    textAlign: 'center',
    paddingTop: Space.xs,
  },
});
