import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  enablePushNotifications,
  pushPermissionGranted,
  pushPermissionState,
  pushPossible,
} from '@/features/notifications/push';
import { analytics } from '@/lib/analytics';

/**
 * One key per reason, plus one counting them.
 *
 * v1 was a single key: asked once, ever, whichever moment spent it. That
 * rule was written down in this file in the founder's own words, and it was
 * wrong for a reason nobody could see until the moments existed. Both of the
 * moments are OUTBOUND - you sent a hello, you posted a pin - so somebody who
 * finishes signup and then just browses for a week is never asked at all, and
 * the highest-value notification this product has, somebody said hi to YOU,
 * is discoverable only by opening the app and looking.
 *
 * So: per reason, with a lifetime cap of two asks. Two is not nagging, the
 * settings row is the always-available third path, and the same reason is
 * never asked twice however the first went.
 *
 * The v1 to v2 rename un-asks every existing device once. On a pre-launch
 * app with no users that is free; shipped after launch it would be a
 * one-time re-ask of everybody, which is worth knowing before shipping it
 * late.
 */
const KEY_PREFIX = 'samewhere.push.primer.v2.';
const COUNT_KEY = 'samewhere.push.primer.v2.asks';

/** Two, ever, across every reason. */
export const ASK_CAP = 2;

/**
 * Why we are asking, which changes the sentence people read.
 *
 * 'hello-received' is the inbound one and the reason the cap exists: it is
 * the first moment somebody has written TO this person, and under the
 * single-ask rule it could never be reached, because the outbound moments
 * always came first or never came at all.
 */
export type PrimerReason = 'hello-sent' | 'pin-posted' | 'hello-received';

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
   * Silently does nothing when notifications are already on, when the OS has
   * already been told no, when this device cannot receive them at all
   * (simulator, Expo Go, no EAS project), when this same reason has been
   * offered before, or when both of the account's asks are spent.
   *
   * This file used to say "asking twice is how an app teaches somebody to
   * reflexively decline", and stopped at one ask for ever. The rule it
   * produced was worse than the one it feared: every moment that could ask
   * was one the person had just acted on, so somebody who reads rather than
   * writes was never asked at all and the first hello landed in silence.
   * Two, keyed per reason, is the founder's answer (2026-09-01) - and the
   * same reason still never asks twice, which is the half of the old rule
   * that was right.
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
  canAsk: (reason: PrimerReason | BusinessPrimerReason) => Promise<boolean>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
};

async function offeredFor(reason: PrimerReason | BusinessPrimerReason): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_PREFIX + reason)) != null;
  } catch {
    // A device that cannot read this is one that will be asked once more.
    // Better than never asking at all.
    return false;
  }
}

/** How many of the account's two asks have been spent, across all reasons. */
async function asksSpent(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(COUNT_KEY);
    const spent = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(spent) && spent > 0 ? spent : 0;
  } catch {
    return 0;
  }
}

async function markOffered(reason: PrimerReason | BusinessPrimerReason): Promise<void> {
  try {
    // Idempotent: answering the same question twice (a re-render racing the
    // OS dialog) must not burn both asks.
    if ((await AsyncStorage.getItem(KEY_PREFIX + reason)) != null) {
      return;
    }
    const spent = await asksSpent();
    await AsyncStorage.setItem(KEY_PREFIX + reason, new Date().toISOString());
    await AsyncStorage.setItem(COUNT_KEY, String(spent + 1));
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
async function worthAsking(
  open: PrimerReason | BusinessPrimerReason | null,
  reason: PrimerReason | BusinessPrimerReason
): Promise<boolean> {
  if (!pushPossible()) {
    return false;
  }
  if (open != null || (await offeredFor(reason)) || (await asksSpent()) >= ASK_CAP) {
    return false;
  }
  if (await pushPermissionGranted()) {
    return false;
  }
  // The clause the single-key version could not express. pushPermissionGranted
  // answers false for "not yet" and for "the OS has already been told no"
  // alike, so a re-armed sheet would offer a Notify me that calls
  // requestPermissionsAsync, gets 'denied' back in the same frame, and
  // registers nothing. Once iOS has the answer, only Settings can change it.
  return (await pushPermissionState()) !== 'denied';
}

export const usePushPrimer = create<PrimerState>((set, get) => ({
  reason: null,
  asking: null,
  busy: false,

  ask: async (reason) => {
    if (!(await worthAsking(get().asking ?? get().reason, reason))) {
      return;
    }
    analytics.capture('push_primer_shown', { reason });
    set({ reason, asking: reason });
  },

  askBusiness: async (reason) => {
    if (!(await worthAsking(get().asking ?? get().reason, reason))) {
      return false;
    }
    analytics.capture('push_primer_shown', { reason });
    // `asking` and not `reason`: setting the second would put the traveler
    // sheet on a business's screen.
    set({ asking: reason });
    return true;
  },

  canAsk: (reason) => worthAsking(get().asking ?? get().reason, reason),

  accept: async () => {
    const reason = get().asking ?? get().reason;
    set({ busy: true });
    // Marked before the OS dialog, not after: whichever way that goes, the
    // question has been asked, and iOS only ever shows it once anyway.
    if (reason != null) {
      await markOffered(reason);
    }
    const result = await enablePushNotifications();
    analytics.capture('push_primer_answered', { reason: reason ?? '', answer: result });
    set({ reason: null, asking: null, busy: false });
  },

  decline: async () => {
    const reason = get().asking ?? get().reason;
    if (reason != null) {
      await markOffered(reason);
    }
    analytics.capture('push_primer_answered', { reason: reason ?? '', answer: 'not_now' });
    set({ reason: null, asking: null });
  },
}));
