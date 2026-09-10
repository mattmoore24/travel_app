import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Sheet, leavingSheet } from '@/components/ui/sheet';
import { Space } from '@/constants/theme';
import { inviteTokenFrom } from '@/features/groups/invite-token';

/**
 * A real field for an invite, on every platform.
 *
 * This replaces an `Alert.prompt` that existed only on iOS — the Android and
 * web arm was a plain alert with no input at all, so somebody holding a code
 * had no way in whatsoever. It was the one `Platform.OS` branch in the app
 * whose non-iOS arm removed a capability instead of substituting one.
 *
 * Most people paste the whole message, not the bare code: long-pressing a
 * bubble copies everything in it, link and fallback line included. So the
 * paste goes through `inviteTokenFrom`, which digs the token out of an https
 * /i/ link, an old scheme link, or a whole pasted message.
 *
 * FormTextField is opaque on purpose — a TextInput inside a
 * UIVisualEffectView never receives the tap that would focus it — so keep
 * this sheet free of glass primitives.
 */
export function InviteCodeSheet({ onClose }: { onClose: () => void }) {
  const [pasted, setPasted] = useState('');
  const token = inviteTokenFrom(pasted);

  const join = () => {
    if (token.length === 0) {
      return;
    }
    // Never push from under a presented sheet: the route lands in the stack
    // below while the sheet's full-screen scrim survives, and the screen you
    // come back to is dead to touch. leavingSheet dismisses first and goes
    // once the sheet has finished leaving.
    leavingSheet(onClose)(() => router.push(`/join-group/${encodeURIComponent(token)}`));
  };

  return (
    // NOTHING ABOVE THE KEYBOARD BUT OUR OWN BAR, and this sheet was breaking
    // that rule in the one way a bare `avoidKeyboard` always does: the lift is
    // the whole keyboard, so the sheet rises as a block and carries Join and
    // Cancel up with it, parked in the strip the founder reserved for Hide
    // keyboard. The field autofocuses, so that was the state this sheet opened
    // in every time.
    //
    // `scrolls` with the buttons in `footer` is the fix the Sheet already
    // knows: the footer is measured and becomes the keyboard allowance, so the
    // sheet lifts by only the part of the keyboard reaching past it. The field
    // stays visible, the buttons go under, and at the largest text sizes the
    // question can scroll instead of pushing its own answers off the bottom.
    <Sheet
      onClose={onClose}
      avoidKeyboard
      scrolls
      footer={
        <View style={styles.footer}>
          <PrimaryButton label="Join" disabled={token.length === 0} onPress={join} />
          <PrimaryButton variant="ghost" label="Cancel" onPress={onClose} />
        </View>
      }>
      <View style={styles.body}>
        <ThemedText type="headline">Have an invite?</ThemedText>
        <FormTextField
          label="Invite code"
          hint="A link or the whole message works too."
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Paste what you were sent"
          value={pasted}
          onChangeText={setPasted}
          onSubmitEditing={join}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // The gaps the Sheet's own children used to get for free. A `scrolls` sheet
  // hands its children to a ScrollView and its footer to a sibling, so each
  // half now owns its own spacing.
  body: {
    gap: Space.md,
  },
  footer: {
    gap: Space.sm,
  },
});
