import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Best-effort push registration after sign-in. Remote push needs a physical
 * device, an EAS project id, and (on iOS) a dev build — none of which exist
 * in Expo Go or the simulator — so every failure path is a silent skip.
 */
export async function registerForPushNotifications(): Promise<void> {
  if (!isSupabaseConfigured || Platform.OS === 'web' || !Device.isDevice) {
    return;
  }
  try {
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      return; // EAS not configured yet (founder step) — skip quietly
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      return;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
    });
  } catch {
    // Expo Go, simulators, or permission oddities — never block sign-in on push.
  }
}
