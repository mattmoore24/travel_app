import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { enablePushNotifications, pushPermissionGranted } from '@/features/notifications/push';
import { analytics } from '@/lib/analytics';

const KEY = 'samewhere.push.primer.v1';

/** Why we are asking, which changes the sentence people read. */
export type PrimerReason = 'hello-sent' | 'pin-posted';

type PrimerState = {
  reason: PrimerReason | null;
  busy: boolean;
  /**
   * Offer to turn notifications on, if there is anything to offer.
   *
   * Silently does nothing when notifications are already on, when this device
   * cannot receive them at all (simulator, Expo Go, no EAS project), or when
   * the offer has been made once already. Asking twice is how an app teaches
   * somebody to reflexively decline.
   */
  ask: (reason: PrimerReason) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
};

async function alreadyOffered(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) != null;
  } catch {
    // A device that cannot read this is one that will be asked once more.
    // Better than never asking at all.
    return false;
  }
}

async function markOffered(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, new Date().toISOString());
  } catch {
    // Nothing to do: worst case the offer is made again next launch.
  }
}

export const usePushPrimer = create<PrimerState>((set, get) => ({
  reason: null,
  busy: false,

  ask: async (reason) => {
    if (get().reason != null || (await alreadyOffered()) || (await pushPermissionGranted())) {
      return;
    }
    analytics.capture('push_primer_shown', { reason });
    set({ reason });
  },

  accept: async () => {
    const reason = get().reason;
    set({ busy: true });
    // Marked before the OS dialog, not after: whichever way that goes, the
    // question has been asked, and iOS only ever shows it once anyway.
    await markOffered();
    const result = await enablePushNotifications();
    analytics.capture('push_primer_answered', { reason: reason ?? '', answer: result });
    set({ reason: null, busy: false });
  },

  decline: async () => {
    const reason = get().reason;
    await markOffered();
    analytics.capture('push_primer_answered', { reason: reason ?? '', answer: 'not_now' });
    set({ reason: null });
  },
}));
