import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Sheet } from '@/components/ui/sheet';
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
    body: 'We will ping you when somebody replies or says hi, and if anything happens to your account. Nothing else, ever.',
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

  if (reason == null) {
    return null;
  }
  const copy = COPY[reason];

  return (
    <Sheet onClose={decline}>
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
        <PrimaryButton label="Notify me" loading={busy} onPress={accept} />
        <PrimaryButton variant="ghost" label="Not now" disabled={busy} onPress={decline} />
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
});
