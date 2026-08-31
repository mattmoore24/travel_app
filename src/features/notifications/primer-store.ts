import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  enablePushNotifications,
  pushPermissionGranted,
  pushPossible,
} from '@/features/notifications/push';
import { analytics } from '@/lib/analytics';

const KEY = 'samewhere.push.primer.v1';

/** Why we are asking, which changes the sentence people read. */
export type PrimerReason = 'hello-sent' | 'pin-posted';

/**
 * The same question, for the account that can do neither of those things.
 *
 * Deliberately NOT a PrimerReason. Both of those are things only a traveler
 * does, so a business was never asked at all, and inbound traveler messages
 * never reached the owner's phone - the one notification a business is here
 * for. Widening PrimerReason would have raised the traveler sheet, which
 * asks in a traveler's words ("Want to know when they answer?"); a business
 * is asked on its own screen, in its own words, by whoever calls askBusiness.
 */
export type BusinessPrimerReason = 'listing-live';

type PrimerState = {
  /** What the sheet in push-primer.tsx is showing, if anything. */
  reason: PrimerReason | null;
  /**
   * What the open question is about, sheet or not.
   *
   * Kept apart from `reason` so a business's answer is filed under the moment
   * that earned it rather than under an empty string, and so one question is
   * open at a time whichever surface asked it.
   */
  asking: PrimerReason | BusinessPrimerReason | null;
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
  /**
   * The same offer, asked by a business screen in its own words.
   *
   * Answers whether it is worth asking at all, on exactly the terms above,
   * and leaves the asking to the caller: this store has no sheet a business
   * would recognise. Answer it with accept() or decline() like any other.
   */
  askBusiness: (reason: BusinessPrimerReason) => Promise<boolean>;
  /**
   * Whether ask() would actually present anything right now.
   *
   * For surfaces that draw their own "Turn on notifications" affordance: a
   * tap that ask() would silently swallow (already offered, already granted,
   * push impossible on this device, a question already open) must not be
   * offered at all. Read-only — records nothing, shows nothing.
   */
  canAsk: () => Promise<boolean>;
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

/**
 * Whether there is a question worth putting to anybody right now.
 *
 * pushPossible FIRST, and separately from the permission read. This has
 * always promised that a device which cannot receive a notification is never
 * asked about one, but the check was `pushPermissionGranted()`, which answers
 * false for "not granted yet" and false for "there is no way to deliver here"
 * alike — so a simulator, Expo Go, or a build with no EAS project id got the
 * sheet, and tapping "Notify me" registered nothing.
 */
async function worthAsking(open: PrimerReason | BusinessPrimerReason | null): Promise<boolean> {
  if (!pushPossible()) {
    return false;
  }
  return !(open != null || (await alreadyOffered()) || (await pushPermissionGranted()));
}

export const usePushPrimer = create<PrimerState>((set, get) => ({
  reason: null,
  asking: null,
  busy: false,

  ask: async (reason) => {
    if (!(await worthAsking(get().asking ?? get().reason))) {
      return;
    }
    analytics.capture('push_primer_shown', { reason });
    set({ reason, asking: reason });
  },

  askBusiness: async (reason) => {
    if (!(await worthAsking(get().asking ?? get().reason))) {
      return false;
    }
    analytics.capture('push_primer_shown', { reason });
    // `asking` and not `reason`: setting the second would put the traveler
    // sheet on a business's screen.
    set({ asking: reason });
    return true;
  },

  canAsk: () => worthAsking(get().asking ?? get().reason),

  accept: async () => {
    const reason = get().asking ?? get().reason;
    set({ busy: true });
    // Marked before the OS dialog, not after: whichever way that goes, the
    // question has been asked, and iOS only ever shows it once anyway.
    await markOffered();
    const result = await enablePushNotifications();
    analytics.capture('push_primer_answered', { reason: reason ?? '', answer: result });
    set({ reason: null, asking: null, busy: false });
  },

  decline: async () => {
    const reason = get().asking ?? get().reason;
    await markOffered();
    analytics.capture('push_primer_answered', { reason: reason ?? '', answer: 'not_now' });
    set({ reason: null, asking: null });
  },
}));
