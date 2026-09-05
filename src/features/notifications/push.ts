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

/**
 * Foreground presentation. Without a handler expo-notifications shows
 * NOTHING while the app is open, so a message arriving while somebody
 * browses the Map was completely silent. Module scope, and this module is
 * imported by the root layout, so the handler exists before any
 * notification can arrive. Field names verified against the installed SDK
 * 57 types: `shouldShowAlert` is deprecated, split into banner/list.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

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

/**
 * The token this device registered, remembered so sign-out never has to ask
 * the network for it. getExpoPushTokenAsync is two network calls (APNs, then
 * Expo's service) and on unreachable APNs the promise can simply NEVER
 * settle — a hang no try/catch can catch — which held the Sign out button
 * shut on exactly the hostel wifi it must survive.
 */
let registeredToken: string | null = null;

/**
 * The Android channel `app.json` names, and the code that makes it exist.
 *
 * `defaultChannel: "default"` in the expo-notifications plugin block writes
 * `com.google.firebase.messaging.default_notification_channel_id` into the
 * manifest — it NAMES a channel, it does not create one. Nothing in this repo
 * called setNotificationChannelAsync, so on Android the id pointed at nothing
 * and the system fell back to a channel of its own making, with a name the
 * app never chose. A config naming a channel nothing creates is a config that
 * does not do what it says.
 *
 * Created here rather than at module scope because this is the moment the
 * device is actually going to receive something, and it is the same moment on
 * every launch that already has permission (refreshPushToken). Android
 * treats the call as an upsert, so repeating it is free; the id is the only
 * part that must stay in step with app.json, which
 * src/app/__tests__/notification-config.test.ts asserts.
 *
 * iOS has no such thing and the module does not export the function there.
 */
const ANDROID_CHANNEL = 'default';

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    // Seen in Android's own settings, so it is copy: it says what arrives on
    // this channel rather than repeating the app's name back at somebody.
    name: 'Messages and plans',
    // A hello or a message is a banner on iOS, and HIGH is the Android
    // importance that behaves the same way. DEFAULT would make every one of
    // them a silent line in the shade.
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function storeToken(): Promise<Registration> {
  const id = projectId();
  if (!id) {
    return 'unavailable';
  }
  await ensureAndroidChannel();
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  registeredToken = token;
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

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/**
 * What iOS currently holds, as three states the settings row can render.
 * Reads, never prompts. The AsyncStorage primer flag is NOT this: the flag
 * records that we asked, and says nothing about the OS answer today.
 */
export async function pushPermissionState(): Promise<PushPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') {
    return 'granted';
  }
  return status === 'denied' ? 'denied' : 'undetermined';
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
 * Unbind THIS DEVICE's push token from the account on the way out of it.
 *
 * Nothing ever called the delete-own policy on push_tokens
 * (20260816220000_chat_realtime.sql), so a signed-out phone kept its row and
 * went on showing a real sender's name on the lock screen — the one place in
 * this app where a name reaches somebody who is not signed in. Worse, the
 * next account on the same phone re-registered the same token, so the
 * previous owner's messages could land on the wrong person's lock screen.
 *
 * Must run while the session is live (the policy checks auth.uid()), so
 * callers do it BEFORE supabase.auth.signOut. Deletes by token value, not by
 * user, which is exactly the "this device leaves" semantic. And it must
 * never block the sign out: catch and continue, the way refreshPushToken
 * already does.
 */
export async function forgetPushToken(): Promise<void> {
  if (!pushPossible() || registeredToken == null) {
    // A cold cache (this launch never registered) means there is nothing we
    // can delete without asking the network for the token, and asking the
    // network is the hang this function exists to avoid. The row is merely
    // orphaned: register_push_token deletes by token value before inserting,
    // so the next account holding this device re-fences it.
    return;
  }
  try {
    await supabase.from('push_tokens').delete().eq('token', registeredToken);
    registeredToken = null;
  } catch {
    // A token we could not delete must never hold the door shut on the way
    // out. The row is orphaned, not leaked: delivery to it stops mattering
    // the moment the next account registers the same token over it.
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
