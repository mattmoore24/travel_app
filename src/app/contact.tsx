import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { useIsBusiness } from '@/features/business/hooks';
import { useSendSupportMessage } from '@/features/support/hooks';
import { useOwnEmail } from '@/features/profile/hooks';

const MIN_BODY = 10;
const MAX_BODY = 4000;

/** Same shape the database check enforces; catching it here is only manners. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Reaching a human, without the app printing anybody's personal address.
 *
 * Open to guests on purpose: someone who cannot sign in is exactly the
 * person most likely to need to write in.
 */
export default function ContactScreen() {
  const ownEmail = useOwnEmail();
  // A business account has no traveler profile to open a Report from, so the
  // line telling it to use one was directions to a door it does not have.
  const viewerIsBusiness = useIsBusiness();
  const send = useSendSupportMessage();
  const [email, setEmail] = useState(ownEmail ?? '');
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmedEmail = email.trim();
  const trimmedBody = body.trim();
  const emailError =
    trimmedEmail.length > 0 && !EMAIL.test(trimmedEmail)
      ? 'That does not look like an email address.'
      : null;
  const bodyError =
    touched && trimmedBody.length > 0 && trimmedBody.length < MIN_BODY
      ? 'A little more detail helps us actually help.'
      : null;
  const ready = EMAIL.test(trimmedEmail) && trimmedBody.length >= MIN_BODY;

  const submit = async () => {
    setTouched(true);
    if (!ready || send.isPending) {
      return;
    }
    try {
      await send.mutateAsync({ replyTo: trimmedEmail, body: trimmedBody });
      Alert.alert('Message sent', 'Thanks. We read every one and will reply to that address.', [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch {
      // Surfaced by the global mutation error alert, which carries the
      // database's own message (including the "you have sent a few already"
      // one), so there is nothing better to say here.
    }
  };

  return (
    <StepScreen
      title="Contact us"
      subtitle="Questions, appeals, anything that feels off. A real person reads every message."
      continueLabel="Send"
      continueDisabled={!ready}
      continueLoading={send.isPending}
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      onContinue={submit}>
      <FormTextField
        label="Your email"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        error={emailError}
        hint={emailError ? undefined : 'So we can reply.'}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        testID="contact-email"
      />
      <FormTextField
        label="Message"
        placeholder="What is going on?"
        value={body}
        onChangeText={setBody}
        onBlur={() => setTouched(true)}
        error={bodyError}
        multiline
        numberOfLines={6}
        maxLength={MAX_BODY}
        style={{ minHeight: 140, textAlignVertical: 'top' }}
        testID="contact-message"
        {...keyboardDoneProps}
      />
      <ThemedText type="footnote" themeColor="textSecondary">
        {viewerIsBusiness
          ? 'Reporting someone? Use Report in the chat. It carries the context.'
          : 'Reporting someone? Use Report on their profile or in the chat. It carries the context.'}
      </ThemedText>
    </StepScreen>
  );
}
