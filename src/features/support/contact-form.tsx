import { useState } from 'react';
import { Alert } from 'react-native';

import { ChipRail } from '@/components/form/chip-rail';
import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { useIsBusiness } from '@/features/business/hooks';
import { useOwnEmail } from '@/features/profile/hooks';
import { useSendSupportMessage } from '@/features/support/hooks';

const MIN_BODY = 10;
const MAX_BODY = 4000;

/**
 * What kind of message this is, in the sender's words.
 *
 * One box served an appeal against a closed account, a bug report, and
 * somebody being followed back to their hostel, and nothing let a one-person
 * support queue tell them apart. The chip is a triage hint and nothing more:
 * it orders the queue and names the push, and the database never reads it as
 * permission.
 *
 * No label may contain the word the design brief bans for a message; these
 * say what happened, not what is being asked for.
 */
export type SupportCategory = 'safety' | 'account' | 'other';

export const SUPPORT_CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: 'safety', label: 'Something happened' },
  { value: 'account', label: 'My account' },
  { value: 'other', label: 'Something else' },
];

/**
 * What the sender is told to expect, per category. A flat "we read every one"
 * set the same expectation for a feature idea and for somebody who is
 * frightened, which is the one place a vague promise costs something.
 */
export const SUPPORT_SENT_NOTE: Record<SupportCategory, string> = {
  safety:
    'Thanks. Anything about safety goes to the top of the pile, and we reply to that address. If you are in danger right now, call your local emergency number first.',
  account: 'Thanks. We look at account messages within a day and reply to that address.',
  other: 'Thanks. A real person reads every message and replies to that address.',
};

/** Same shape the database check enforces; catching it here is only manners. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The contact form, as a component rather than a screen.
 *
 * Extracted so it can be rendered from behind the account gate, where there
 * is no navigator at all: the root layout returns the gate INSTEAD OF the
 * Stack, so router.push does nothing and the one person the appeal route
 * exists for could not reach it. Everything routing-shaped is a callback.
 *
 * StepScreen stays as the wrapper on purpose. It owns the keyboard handling
 * (KeyboardFloor, which asks the keyboard for its real height instead of
 * letting KeyboardAvoidingView measure against a parent that is not the
 * window), and losing that in an extraction would put the message field under
 * the keyboard on the one screen somebody types a paragraph into.
 */
export function ContactForm({
  initialBody = '',
  onDone,
  onClose,
  showReportHint = true,
}: {
  /** Pre-filled first line, e.g. an appeal naming what was restricted. */
  initialBody?: string;
  /** After a successful send, once the confirmation is acknowledged. */
  onDone: () => void;
  /** The close control. Omitted where there is nowhere to close to. */
  onClose?: () => void;
  /**
   * "Reporting someone? Use Report on their profile." False behind the gate,
   * where no profile and no chat is reachable, and directions to a door
   * somebody cannot open are worse than none.
   */
  showReportHint?: boolean;
}) {
  const ownEmail = useOwnEmail();
  // A business account has no traveler profile to open a Report from, so the
  // line telling it to use one was directions to a door it does not have.
  const viewerIsBusiness = useIsBusiness();
  const send = useSendSupportMessage();
  const [email, setEmail] = useState(ownEmail ?? '');
  const [body, setBody] = useState(initialBody);
  // An appeal already knows what it is about, so the chip is not a fifth
  // thing to fill in for somebody who has just been locked out.
  const [category, setCategory] = useState<SupportCategory | null>(
    initialBody.length > 0 ? 'account' : null
  );
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
  const ready = category != null && EMAIL.test(trimmedEmail) && trimmedBody.length >= MIN_BODY;

  const submit = async () => {
    setTouched(true);
    if (!ready || send.isPending) {
      return;
    }
    if (category == null) {
      return;
    }
    try {
      await send.mutateAsync({ replyTo: trimmedEmail, body: trimmedBody, category });
      Alert.alert('Message sent', SUPPORT_SENT_NOTE[category], [{ text: 'Done', onPress: onDone }]);
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
      note={category == null ? 'Pick what this is about first.' : null}
      onClose={onClose}
      onContinue={submit}>
      <ThemedText type="smallBold">What is this about?</ThemedText>
      <ChipRail
        wrap
        options={SUPPORT_CATEGORIES}
        selected={category}
        onSelect={(value) => setCategory(value)}
      />
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
      {showReportHint ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {viewerIsBusiness
            ? 'Reporting someone? Use Report in the chat. It carries the context.'
            : 'Reporting someone? Use Report on their profile or in the chat. It carries the context.'}
        </ThemedText>
      ) : null}
    </StepScreen>
  );
}
