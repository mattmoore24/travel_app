import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Type } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/store';
import {
  useBusinessCodeStatus,
  useConfirmBusinessEmail,
  useRequestBusinessEmailCode,
} from '@/features/business/hooks';
import { StepShell } from '@/features/signup/step-shell';
import { BUSINESS_TOTAL_STEPS } from '@/features/signup/steps';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';

const CODE_LENGTH = 6;
/** What the migration gives a code: twenty minutes, then it is not a code. */
const CODE_TTL_MS = 20 * 60 * 1000;

/**
 * Where the code was sent, remembered on the device.
 *
 * The address cannot be read back from the server: `business_email_confirmations`
 * has no client grants at all, and `my_business()` does not carry the column. So
 * the only way this screen can name the inbox, or send a second code to the same
 * one, is to be handed the address and to keep it.
 *
 * Keyed by account, not by device. A resend REWRITES the address on file, so a
 * phone that has seen two businesses must never send one's code to the other's
 * inbox.
 */
const addressKey = (userId: string) => `samewhere.business.email.${userId}`;

/**
 * Whether the code that was sent has run out, without reading the clock
 * during render (the compiler's purity rule, and it is right: a value that
 * changes on its own has to change on a timer somebody can see). The timeout
 * is set for the exact minute it dies, so a screen left open flips its own
 * copy instead of lying until the next tap.
 */
function useCodeExpired(sentAtMs: number | null): boolean {
  // Which code has run out, rather than a bare boolean. A resend gives a new
  // sent_at, which no longer matches, so the screen goes back to "check your
  // email" without anything having to reset it. Nothing calls setState in the
  // effect body either, which is the rule that stops cascading renders.
  const [expiredFor, setExpiredFor] = useState<number | null>(null);
  useEffect(() => {
    if (sentAtMs == null || Number.isNaN(sentAtMs)) {
      return;
    }
    const left = sentAtMs + CODE_TTL_MS - Date.now();
    const timer = setTimeout(() => setExpiredFor(sentAtMs), Math.max(left, 0));
    return () => clearTimeout(timer);
  }, [sentAtMs]);
  return sentAtMs != null && expiredFor === sentAtMs;
}

/**
 * The last step of getting listed: six digits, and the place goes live.
 *
 * A code rather than a tappable link, which is the migration's choice and not
 * this screen's: a link needs deep-link handling and an associated-domain
 * entitlement, so it would cost a native build, and a code ships over the air.
 */
export default function BusinessEmailScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const confirm = useConfirmBusinessEmail();
  const resend = useRequestBusinessEmailCode();
  const [code, setCode] = useState('');
  const [sentAgain, setSentAgain] = useState(false);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [alreadyUsed, setAlreadyUsed] = useState(false);
  // The address is editable from here, always. It is the only recovery there
  // is: nothing on the server will tell this screen where the mail went, so a
  // typed address that never receives anything is otherwise the end of the
  // journey with the listing left dark.
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState('');
  // Whether the mail actually left. Asked while somebody is looking at an
  // empty six-digit box, because that is exactly the minute in which "we sent
  // it" turning out to be false is worth knowing. The founder waited for a
  // code that a provider had already refused to carry, and this screen went on
  // saying it had been sent.
  const { data: delivery } = useBusinessCodeStatus(!changing);
  const bounced = delivery?.failed === true;
  // "We sent you a code" is only true for twenty minutes. This screen is
  // reached again from the dashboard days later, with the address remembered
  // on the device, and it went on saying a code was on its way to an inbox
  // that had nothing in it. `sent_at` is the only honest clock either side
  // has.
  const sentAt = delivery?.sent_at != null ? Date.parse(delivery.sent_at) : null;
  const codeExpired = useCodeExpired(sentAt) && !sentAgain;
  // Whoever routed here knows the address; storage is only the fallback for a
  // second visit, so the handed value always wins rather than being copied
  // into state and then argued with.
  const handed = params.email?.trim() || null;
  const address = handed ?? remembered;

  useEffect(() => {
    let active = true;
    const key = userId != null ? addressKey(userId) : null;
    if (key != null && handed != null) {
      AsyncStorage.setItem(key, handed).catch(() => {});
    } else if (key != null) {
      AsyncStorage.getItem(key)
        .then((stored) => {
          if (active && stored) {
            setRemembered(stored);
          }
        })
        .catch(() => {
          // A device that cannot read this loses the resend button and nothing
          // else. Typing the code still works.
        });
    }
    return () => {
      active = false;
    };
  }, [handed, userId]);

  const submit = async () => {
    if (code.length !== CODE_LENGTH) {
      return;
    }
    try {
      const result = await confirm.mutateAsync(code);
      analytics.capture('business_email_confirmed', { first_time: result.first_time });
      haptics.success();
      if (!result.first_time) {
        // The same code, used twice. It still relists — a rename is what sends
        // a confirmed place back here, and the address on file is unchanged —
        // but saying nothing would leave somebody wondering whether it took.
        setAlreadyUsed(true);
      }
      // No congratulations dialog. The button said what would happen and the
      // next screen is it. An alert fired at the same moment this screen
      // starts leaving is also the presentation iOS quietly drops, and on
      // Fabric a dropped presentation takes touch with it (skills/traps).
      //
      // This line killed the app for the founder, with the listing already
      // live on the server, and the fix is in app/_layout: this screen is no
      // longer presented as a modal, because registering the business filters
      // `onboarding` out of the navigator underneath it and leaves it as the
      // only route in the stack — and a modal at index 0 is a state
      // react-native-screens has to reshuffle out of, mid-replace, into a
      // group that mounts native tabs in the same commit.
      router.replace('/(tabs)');
    } catch {
      // The global mutation alert carries the database's own words ("that code
      // is not right", "that code has expired"). Empty the box, because the
      // next attempt is six fresh digits rather than an edit of these.
      haptics.error();
      setCode('');
    }
  };

  const sendAgain = async (to?: string) => {
    const target = (to ?? address ?? '').trim();
    if (target === '') {
      return;
    }
    try {
      await resend.mutateAsync(target);
      haptics.success();
      setSentAgain(true);
      setChanging(false);
      setRemembered(target);
      setCode('');
    } catch {
      // Surfaced by the global mutation error alert. The refusal that matters
      // is the fifth send of the day, and it arrives in the server's words.
    }
  };

  return (
    // The same shell every other step of this sequence wears, carrying the
    // same bar. This screen owned its own chrome and so drew no bar at all,
    // while the form behind it had already filled one to 12 of 12 — the
    // sequence promised it was over one screen before the screen that turns
    // the lights on.
    <StepShell
      step={BUSINESS_TOTAL_STEPS}
      total={BUSINESS_TOTAL_STEPS}
      title={
        bounced
          ? 'That address bounced'
          : codeExpired
            ? 'That code has run out'
            : 'Check your email'
      }
      subtitle={
        bounced
          ? address
            ? `We could not deliver to ${address}. Try another address and we will send a fresh code.`
            : 'We could not deliver that one. Try another address and we will send a fresh code.'
          : codeExpired
            ? address
              ? `The code we sent to ${address} has run out. Send yourself a fresh one.`
              : 'The last code has run out. Send yourself a fresh one.'
            : address
              ? `We sent a six-digit code to ${address}. It lasts twenty minutes.`
              : 'We sent a six-digit code to your business email. It lasts twenty minutes.'
      }
      continueLabel="Put my business on the map"
      continueDisabled={code.length !== CODE_LENGTH}
      continueLoading={confirm.isPending}
      note={code.length === CODE_LENGTH ? null : 'Six digits, from the email.'}
      // No back chevron: this screen is arrived at by `replace`, so there is
      // nothing behind it to go back TO. The way out is the last thing in the
      // footer, in the words the form itself uses, because without one the
      // only exit from a code that never arrives is to kill the app.
      onContinue={submit}
      footer={
        <>
          {changing ? (
            <>
              <FormTextField
                label="Where should we send it?"
                accessibilityLabel="Business email address"
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="hello@yourbusiness.com"
                value={draft}
                onChangeText={setDraft}
                // Gated the way the button beside it is. Two quick returns fired
                // two sends and burned two of the five a business gets in a
                // day, and the second one unmounted a still-focused field.
                onSubmitEditing={() => {
                  if (!resend.isPending) {
                    sendAgain(draft);
                  }
                }}
                returnKeyType="send"
              />
              <PrimaryButton
                variant="ghost"
                label="Send me a code"
                accessibilityLabel="Send a code to this address"
                disabled={!draft.includes('@')}
                loading={resend.isPending}
                onPress={() => sendAgain(draft)}
              />
            </>
          ) : (
            <>
              {/* Only when we know where it went. Resending needs an address
                and this screen has no honest way to guess one. */}
              {address ? (
                <PrimaryButton
                  // It leads once the last code has expired: an empty six-digit
                  // box under a ghost button is the wrong shape for a screen
                  // whose only next step is a new code.
                  variant={codeExpired && !bounced ? 'filled' : 'ghost'}
                  label="Send it again"
                  accessibilityLabel="Send the code again"
                  loading={resend.isPending}
                  onPress={() => sendAgain()}
                />
              ) : null}
              {/* Always. A typo at signup, a work address nobody reads, or a
                sending domain the provider will not carry, are the ways this
                screen becomes a dead end, and typing a different address is
                the only fix that does not need a person. It leads when we
                already know the last one bounced. */}
              <PrimaryButton
                variant={bounced ? 'filled' : 'ghost'}
                label={address ? 'Use a different address' : 'Send me a code'}
                accessibilityLabel="Send the code to a different address"
                onPress={() => {
                  setDraft(address ?? '');
                  setChanging(true);
                }}
              />
              {sentAgain ? (
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.echo}>
                  Sent. Give it a minute to turn up.
                </ThemedText>
              ) : null}
              {alreadyUsed ? (
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.echo}>
                  That code had already been used. You&apos;re on the map either way.
                </ThemedText>
              ) : null}
            </>
          )}
          {/* Both of these used to live inside the ELSE branch only, so
              tapping "Use a different address" left a screen with one text
              field and one send button on it and no way off at all - not back
              to the code already in hand, and not out of signup. That is the
              dead end the comment above this footer describes as the thing
              this screen exists to remove; it had simply been moved one
              branch over. */}
          {changing && address ? (
            <PrimaryButton
              variant="ghost"
              label="Keep the address you had"
              accessibilityLabel={`Keep sending to ${address}`}
              onPress={() => setChanging(false)}
            />
          ) : null}
          <PrimaryButton
            variant="ghost"
            label="Finish this later"
            accessibilityLabel="Finish this later"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          />
        </>
      }>
      <FormTextField
        label="Code"
        testID="business-code-input"
        accessibilityLabel="Six-digit code"
        autoFocus
        keyboardType="number-pad"
        // number-pad draws no return key at all on iOS, so the accessory bar
        // is the only way off this keyboard (skills/traps).
        maxLength={CODE_LENGTH}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        // Paste from a mail app arrives with whatever was around it.
        onChangeText={(next) => setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        style={styles.code}
      />
    </StepShell>
  );
}

const styles = StyleSheet.create({
  code: {
    fontSize: Type.title.fontSize,
    letterSpacing: 8,
    textAlign: 'center',
  },
  echo: {
    textAlign: 'center',
  },
});
