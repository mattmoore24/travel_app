import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { Type } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/store';
import {
  useBusinessCodeStatus,
  useConfirmBusinessEmail,
  useRequestBusinessEmailCode,
} from '@/features/business/hooks';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';

const CODE_LENGTH = 6;

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
      // next screen is it. An alert fired at the same moment this modal starts
      // dismissing is also the presentation iOS quietly drops, and on Fabric a
      // dropped presentation takes touch with it (skills/traps).
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
    <StepScreen
      title={bounced ? 'That address bounced' : 'Check your email'}
      subtitle={
        bounced
          ? address
            ? `We could not deliver to ${address}. Try another address and we will send a fresh code.`
            : 'We could not deliver that one. Try another address and we will send a fresh code.'
          : address
            ? `We sent a six-digit code to ${address}. It lasts twenty minutes.`
            : 'We sent a six-digit code to your business email. It lasts twenty minutes.'
      }
      continueLabel="Put my business on the map"
      continueDisabled={code.length !== CODE_LENGTH}
      continueLoading={confirm.isPending}
      note={code.length === CODE_LENGTH ? null : 'Six digits, from the email.'}
      // Somewhere to go. Without this the modal's only exit is a swipe down,
      // which nothing on the screen mentions, and this screen is reached by
      // `replace` so there is no back chevron underneath it either.
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      onContinue={submit}
      footer={
        changing ? (
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
              onSubmitEditing={() => sendAgain(draft)}
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
                variant="ghost"
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
        )
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
        {...keyboardDoneProps}
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
  echo: {
    textAlign: 'center',
  },
});
