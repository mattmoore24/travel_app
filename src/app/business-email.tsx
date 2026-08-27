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
import { useConfirmBusinessEmail, useRequestBusinessEmailCode } from '@/features/business/hooks';
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
      await confirm.mutateAsync(code);
      analytics.capture('business_email_confirmed');
      haptics.success();
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

  const sendAgain = async () => {
    if (address == null) {
      return;
    }
    try {
      await resend.mutateAsync(address);
      haptics.success();
      setSentAgain(true);
      setCode('');
    } catch {
      // Surfaced by the global mutation error alert. The refusal that matters
      // is the fifth send of the day, and it arrives in the server's words.
    }
  };

  return (
    <StepScreen
      title="Check your email"
      subtitle={
        address
          ? `We sent a six-digit code to ${address}. It lasts twenty minutes.`
          : 'We sent a six-digit code to your business email. It lasts twenty minutes.'
      }
      continueLabel="Put my place on the map"
      continueDisabled={code.length !== CODE_LENGTH}
      continueLoading={confirm.isPending}
      note={code.length === CODE_LENGTH ? null : 'Six digits, from the email.'}
      onContinue={submit}
      footer={
        // Hidden rather than dead when the address is unknown: sending a code
        // needs an address, and this screen has no honest way to guess one.
        address ? (
          <>
            <PrimaryButton
              variant="ghost"
              label="Send it again"
              accessibilityLabel="Send the code again"
              loading={resend.isPending}
              onPress={sendAgain}
            />
            {sentAgain ? (
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.echo}>
                Sent. Give it a minute to turn up.
              </ThemedText>
            ) : null}
          </>
        ) : null
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
