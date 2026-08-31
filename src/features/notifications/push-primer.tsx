import { useIsFocused } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Sheet, SHEET_SETTLE_MS, usePresentedSheetCount } from '@/components/ui/sheet';
import { Radius, Space } from '@/constants/theme';
import { usePushPrimer, type PrimerReason } from '@/features/notifications/primer-store';
import { useTheme } from '@/hooks/use-theme';

/**
 * The ask, at the first moment there is something worth being told about.
 *
 * Two rules, both load-bearing. It only appears after the app has done the
 * thing a notification would follow — a hello sent, a pin posted — so the
 * question has an obvious answer instead of being an ambush at signup. And
 * the promise is specific and small, because the first notification that
 * falls outside it is the one that sends somebody to Settings to switch the
 * whole channel off.
 */
const COPY: Record<PrimerReason, { title: string; body: string }> = {
  'hello-sent': {
    title: 'Want to know when they answer?',
    body: 'Replies, first messages, and anything about your account. Nothing else, ever.',
  },
  'pin-posted': {
    title: 'Want to know if somebody is in?',
    body: 'We will ping you when somebody answers your pin or messages you, and if anything happens to your account. Nothing else, ever.',
  },
};

export function PushPrimer() {
  const theme = useTheme();
  const reason = usePushPrimer((s) => s.reason);
  const busy = usePushPrimer((s) => s.busy);
  const accept = usePushPrimer((s) => s.accept);
  const decline = usePushPrimer((s) => s.decline);

  // WAIT FOR THE SCREEN TO BE FREE. This is the only thing in the app that
  // presents a sheet on a schedule of its own, and both of the moments that
  // earn it — a hello delivered, a pin posted — happen while another modal
  // is on its way out.
  //
  // A simulator run caught what that costs. The pin form is a Sheet, so a
  // Modal; posting a pin unmounts it and, in the same tick,
  // useCreatePin.onSuccess asks this question. The Modal that mounts on top
  // of a dismissal iOS has not finished is one iOS drops — and the run
  // photographed the result: the confirmation card on screen, four taps
  // registered on it by the driver, and not one pixel changed in the minute
  // that followed. Not a missing question. A dead app, on the one flow the
  // founder uses most.
  //
  // Two gates, because they catch different things. `focused` covers a route
  // presented over the tabs (/compose-request, after a hello). The sheet
  // count covers an in-screen Sheet that no router knows about (the pin
  // form). And the settle delay covers the gap between the two facts that
  // are not the same fact: unmounted in React, and gone from the screen.
  const focused = useIsFocused();
  const sheets = usePresentedSheetCount();
  const [presenting, setPresenting] = useState(false);

  // Reset during render when the question is withdrawn, which is the
  // sanctioned way to store information from a previous render — the same
  // pattern the map markers use to re-arm their rasterisation window.
  const [armedFor, setArmedFor] = useState(reason);
  if (armedFor !== reason) {
    setArmedFor(reason);
    if (presenting) {
      setPresenting(false);
    }
  }

  useEffect(() => {
    // Once it is up it stays up: this sheet is itself a modal, so it counts
    // itself, and re-reading the gate would tear it straight back down.
    if (reason == null || presenting || !focused || sheets > 0) {
      return;
    }
    const timer = setTimeout(() => setPresenting(true), SHEET_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [reason, focused, sheets, presenting]);

  if (reason == null || !presenting) {
    return null;
  }
  const copy = COPY[reason];

  return (
    // `scrolls` with both buttons in the footer: at the largest text sizes
    // the question grew past the screen and pushed its own answers off the
    // bottom, with no way to reach them.
    <Sheet
      onClose={decline}
      scrolls
      footer={
        <View style={styles.footer}>
          <PrimaryButton label="Notify me" loading={busy} onPress={accept} />
          <PrimaryButton variant="ghost" label="Not now" disabled={busy} onPress={decline} />
        </View>
      }>
      <View style={styles.body}>
        <View style={[styles.glyph, { backgroundColor: theme.accentSoft }]}>
          <SymbolView
            name={{ ios: 'bell.badge.fill', android: 'notifications_active', web: 'notifications' }}
            size={24}
            tintColor={theme.accent}
          />
        </View>
        <ThemedText type="subtitle" style={styles.center}>
          {copy.title}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.center}>
          {copy.body}
        </ThemedText>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Space.md,
    paddingTop: Space.sm,
  },
  glyph: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
  footer: {
    gap: Space.md,
  },
});
