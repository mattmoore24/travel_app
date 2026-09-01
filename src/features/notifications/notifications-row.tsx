import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Space } from '@/constants/theme';
import {
  enablePushNotifications,
  pushPermissionState,
  pushPossible,
  type PushPermission,
} from '@/features/notifications/push';
import { useTripClocks } from '@/features/notifications/use-notification-prefs';

/**
 * The undo for the primer.
 *
 * The primer asks at most twice, at earned moments, and then never again - so
 * without this row a "not now" silences every reply and every account notice
 * forever, with nothing anywhere saying that is the state you are in.
 *
 * The row reads the OS, never the AsyncStorage primer flag: the flag records
 * that we asked, not what iOS holds today, so an owner who flipped the switch
 * in Settings would be told they are off. And it never clears that flag -
 * re-arming the primer after an OS-level denial would show a "Notify me"
 * button that registers nothing, because worthAsking tests the OS grant.
 */
export function useNotificationPermission(): {
  state: PushPermission | null;
  enable: () => void;
} {
  const [state, setState] = useState<PushPermission | null>(null);

  const read = useCallback(() => {
    if (!pushPossible()) {
      return;
    }
    pushPermissionState()
      .then(setState)
      .catch(() => {});
  }, []);

  // On focus (covers mount and every return to the screen), and on the app
  // coming back to the foreground. The AppState read is load-bearing: going
  // to iOS Settings and back never changes navigator focus, so without it
  // the row still says Off after the person has just turned them on.
  useFocusEffect(read);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        read();
      }
    });
    return () => sub.remove();
  }, [read]);

  const enable = useCallback(() => {
    // Straight to the OS dialog, NOT Linking.openSettings(): declining the
    // primer never called requestPermissionsAsync, so iOS holds no record of
    // this app and shows no Samewhere entry under Settings, Notifications.
    // Sending somebody there would be sending them to a page that does not
    // exist.
    enablePushNotifications()
      .then(read)
      .catch(() => {});
  }, [read]);

  return { state, enable };
}

/** One short line for a row that has a single value slot to fill. */
export function notificationValueLine(state: PushPermission): string {
  if (state === 'granted') {
    return 'On';
  }
  return state === 'denied' ? 'Off. Turn them on in Settings' : 'Off. Tap to turn them on';
}

/**
 * One Notifications row for both account pages. Renders nothing where push
 * can never work (the simulator, Expo Go, web), because a switch for a
 * channel that cannot deliver is a lie in either position.
 */
export function NotificationsRow() {
  const { state, enable } = useNotificationPermission();

  if (!pushPossible() || state == null) {
    return null;
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Notifications</ThemedText>
      {state === 'granted' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            On. First messages, replies, your own trips and plans, and anything about your account.
          </ThemedText>
          <TripClocksLine />
        </>
      ) : null}
      {state === 'undetermined' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Off. Turn them on and hear when someone answers.
          </ThemedText>
          <PrimaryButton
            variant="ghost"
            label="Turn on notifications"
            accessibilityLabel="Turn on notifications"
            onPress={enable}
          />
        </>
      ) : null}
      {state === 'denied' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Off. Turn them on in Settings
          </ThemedText>
          <PrimaryButton
            variant="ghost"
            label="Open Settings"
            accessibilityLabel="Open Settings"
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
          />
        </>
      ) : null}
    </ThemedView>
  );
}

/**
 * The second line, and the only notification switch this app owns.
 *
 * Only under `granted`: a preference about which pushes arrive is nonsense
 * on a phone that has refused all of them, and offering it there would be
 * the same lie as a switch for a channel that cannot deliver.
 *
 * A ghost button rather than a platform Switch, because this app has no
 * Switch anywhere and one control introduced for one row is a vocabulary of
 * its own. It carries the switch ROLE and state so VoiceOver reads it as
 * what it is.
 */
function TripClocksLine() {
  const { on, set, saving } = useTripClocks();

  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        {on
          ? 'Trip reminders are on. The evening before a trip starts, and when a plan you are in is happening.'
          : 'Trip reminders are off. Replies and account notices still arrive.'}
      </ThemedText>
      <PrimaryButton
        variant="ghost"
        label={on ? 'Turn off trip reminders' : 'Turn on trip reminders'}
        accessibilityRole="switch"
        accessibilityState={{ checked: on, disabled: saving }}
        // The SAME words that are written on it. PressableProps spread last
        // in PrimaryButton, so an accessibility label here replaces the
        // visible one outright — and it used to say "Trip reminders", which
        // meant a Voice Control user reading the button in front of them and
        // saying "Tap Turn off trip reminders" got nothing at all. Whatever
        // is written on a control has to be part of what it answers to.
        accessibilityLabel={on ? 'Turn off trip reminders' : 'Turn on trip reminders'}
        disabled={saving}
        onPress={() => set(!on)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.xs,
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
});
