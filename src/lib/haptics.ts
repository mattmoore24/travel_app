import * as ExpoHaptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * The app's haptic vocabulary — semantic names so every screen reaches for the
 * same physical feel per meaning (docs/DESIGN.md "Motion & touch"). Failures
 * are swallowed: a haptic is never worth an error path.
 */
export const haptics = {
  /** Filter chips, segmented choices, pickers ticking over. */
  selection() {
    if (enabled) ExpoHaptics.selectionAsync().catch(() => {});
  },
  /** Touch-down acknowledgement on primary buttons and cards. */
  soft() {
    if (enabled) ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Soft).catch(() => {});
  },
  /** Something opened or engaged — entering a mode, presenting a sheet. */
  light() {
    if (enabled) ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  /** Something landed — a pin dropped, a photo placed. */
  medium() {
    if (enabled) ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  /** A flow completed for real (posted, accepted, verified). */
  success() {
    if (enabled)
      ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success).catch(() => {});
  },
  /** Destructive confirmation (delete, leave) — softer than error. */
  warning() {
    if (enabled)
      ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  /** Something failed or was refused (search miss, moderation block). */
  error() {
    if (enabled)
      ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error).catch(() => {});
  },
};
