import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Push registration, split into the part that may ask and the part that must
 * not.
 *
 * The whole file used to be one function called from the auth listener, so
 * the OS permission dialog fired the instant an account existed — before the
 * person had sent a single message, in the middle of a signup flow, with
 * nothing on screen to explain what they would be notified about. A "no"
 * there is close to permanent: it can only be undone in Settings, which
 * nobody goes to for an app they have used for ninety seconds.
 *
 * So: `refreshPushToken` is the silent path (already granted — keep the
 * token fresh, never prompt), and `enablePushNotifications` is the loud one,
 * called only from the primer, only after the app has done something worth
 * being notified about.
 */

type Registration = 'registered' | 'denied' | 'unavailable';

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Remote push needs a physical device, an EAS project id, and (on iOS) a real
 * build — none of which exist in Expo Go or the simulator.
 *
 * Exported because the primer needs to know the difference between "not
 * granted yet" and "cannot ever work here". Asking on a device that can
 * never deliver is a question whose only honest answer is nothing.
 */
export function pushPossible(): boolean {
  return isSupabaseConfigured && Platform.OS !== 'web' && Device.isDevice && projectId() != null;
}

async function storeToken(): Promise<Registration> {
  const id = projectId();
  if (!id) {
    return 'unavailable';
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  return 'registered';
}

/**
 * Has this person already said yes? Used to decide whether the primer has
 * anything to ask about. Never prompts.
 */
export async function pushPermissionGranted(): Promise<boolean> {
  if (!pushPossible()) {
    return false;
  }
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Keep an already-granted token fresh. Safe to call on every launch: it reads
 * the permission rather than requesting it, so it can never raise a dialog.
 */
export async function refreshPushToken(): Promise<void> {
  if (!pushPossible()) {
    return;
  }
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      return;
    }
    await storeToken();
  } catch {
    // Never let bookkeeping break a launch.
  }
}

/**
 * Ask the OS. Only ever called from the primer, after somebody has said yes
 * to being asked.
 */
export async function enablePushNotifications(): Promise<Registration> {
  if (!pushPossible()) {
    return 'unavailable';
  }
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      return 'denied';
    }
    return await storeToken();
  } catch {
    return 'unavailable';
  }
}
