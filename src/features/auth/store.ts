import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import type { SignedOutReason } from '@/features/auth/signed-out-reason';
import type { Region } from '@/features/pins/camera';

/**
 * What a guest was DOING when the account wall interrupted them, so the
 * moment after signup can put them back there. The invite token below was
 * the only context that ever survived the wall; this generalises the same
 * idea to the other three origins:
 *
 *   'pin'      — they opened a pin's card and were invited to see who is
 *                going. Replay selects the city, then the card, and degrades
 *                silently to the city alone when the pin has expired
 *                (signup takes minutes; pins live at most 72 hours).
 *   'drop-pin' — they tapped Drop a pin. Replay returns the map to place
 *                mode at the region they had panned to.
 *   'traveler' — they met the gate on the Travelers tab. Replay lands them
 *                back on that tab.
 *
 * Same in-memory lifetime as the invite, and deliberately NEVER persisted:
 * an intent surviving a cold start is a different feature with a different
 * privacy story.
 */
export type PendingIntent = {
  kind: 'pin' | 'traveler' | 'drop-pin';
  cityId: number;
  pinId?: string;
  userId?: string;
  region?: Region | null;
};

type AuthState = {
  /** Restored/live Supabase session; null = signed out. */
  session: Session | null;
  /** True once the initial getSession() has resolved (gate rendering on it). */
  initialized: boolean;
  /**
   * Somebody arrived through a password-recovery link and has not set a new
   * password yet.
   *
   * It is a top-level piece of state rather than a route because the session
   * that link establishes IS a sign-in: without this the route guards would
   * see a signed-in user and swap straight into the app, dropping the person
   * into the tabs with the old password still on the account. While it is
   * non-null the root renders one screen and nothing else.
   *
   * 'establishing' exists because the flag has to go up BEFORE the session
   * lands (or the guards get a frame of ordinary sign-in) — and without a
   * name for that gap the screen would read the not-yet-session as a dead
   * link and flash an expiry notice at somebody whose link is fine.
   */
  recovery: null | { status: 'establishing' | 'ready' | 'failed'; message: string | null };
  /**
   * Somebody who started signing up through "Run a business? Put it on the map"
   * and has not reached the listing form yet.
   *
   * Same reason `recovery` is here: it has to outlive a screen. Creating the
   * account signs you in, which puts the root's readiness hold up, and the
   * hold unmounts the whole navigator — so the `router.replace` fired the
   * moment the account exists is dispatched into a container with nothing
   * mounted and dropped. The person then lands in traveler onboarding, which
   * is the one flow a place must never finish: it stamps
   * `onboarding_completed_at`, and `register_business` refuses an account
   * that carries it.
   *
   * Cleared by the listing form itself, so backing out of it leaves somebody
   * in ordinary onboarding rather than in a loop.
   */
  listingIntent: boolean;
  /**
   * An invite link somebody opened before they had an account.
   *
   * Taking "Make a profile" from an invite used to throw the token away:
   * signing up swaps the whole navigator, so six screens later they were on
   * the map with no idea what had happened to the chat they were invited to.
   * The tabs hand it back the moment they land (see app/(tabs)/_layout).
   *
   * Deliberately NOT persisted. It is worth carrying across a sign-up in one
   * sitting and not worth resurrecting a week later, when the link has very
   * likely expired and the surprise would be worse than the loss.
   */
  pendingInvite: string | null;
  /**
   * What the guest was doing when they took a sign-up gate. Written by the
   * gate's own navigate handler (never by merely seeing the gate, so backing
   * out records nothing), cleared BEFORE the replay navigates — the same
   * rule inviteHandled documents: the replayed screen can be backed out of,
   * and a value still in the store would push it straight back on.
   */
  pendingIntent: PendingIntent | null;
  /**
   * The session ended and nobody on this device asked for it.
   *
   * supabase-js emits the same SIGNED_OUT event for a tapped Sign out and for
   * a refresh token the server has thrown away, so the app used to answer a
   * forced sign-out by silently becoming the signed-out app: the chats, the
   * pins and the avatar all went with no word said. Top-level state rather
   * than a route for the same reason `recovery` is: it has to pre-empt the
   * whole navigator, and there is no stack to push onto at the moment it
   * arrives. Cleared by the screen that shows it.
   */
  signedOutNotice: { reason: SignedOutReason } | null;
  /**
   * Somebody took Sign in from that notice.
   *
   * Clearing the notice remounts the navigator at its anchor, so a
   * `router.push` from the notice screen would be dispatched into a container
   * with nothing in it and dropped. Parked here and spent by the tabs, the
   * same shape as `pendingInvite` and for the same documented reason.
   */
  pendingSignIn: boolean;
  setSession: (session: Session | null) => void;
  setInitialized: () => void;
  recoveryStarted: () => void;
  recoveryReady: () => void;
  recoveryFailed: (message: string) => void;
  endRecovery: () => void;
  listingStarted: () => void;
  listingDone: () => void;
  inviteRemembered: (token: string) => void;
  inviteHandled: () => void;
  intentRemembered: (intent: PendingIntent) => void;
  intentHandled: () => void;
  signedOutUnasked: (reason: SignedOutReason) => void;
  signedOutNoticeSeen: () => void;
  signInWanted: () => void;
  signInHandled: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  initialized: false,
  recovery: null,
  listingIntent: false,
  pendingInvite: null,
  pendingIntent: null,
  signedOutNotice: null,
  pendingSignIn: false,
  setSession: (session) => set({ session }),
  setInitialized: () => set({ initialized: true }),
  recoveryStarted: () => set({ recovery: { status: 'establishing', message: null } }),
  recoveryReady: () => set({ recovery: { status: 'ready', message: null } }),
  recoveryFailed: (message) => set({ recovery: { status: 'failed', message } }),
  endRecovery: () => set({ recovery: null }),
  listingStarted: () => set({ listingIntent: true }),
  listingDone: () => set({ listingIntent: false }),
  inviteRemembered: (token) => set({ pendingInvite: token }),
  inviteHandled: () => set({ pendingInvite: null }),
  intentRemembered: (intent) => set({ pendingIntent: intent }),
  intentHandled: () => set({ pendingIntent: null }),
  signedOutUnasked: (reason) => set({ signedOutNotice: { reason } }),
  signedOutNoticeSeen: () => set({ signedOutNotice: null }),
  signInWanted: () => set({ pendingSignIn: true }),
  signInHandled: () => set({ pendingSignIn: false }),
}));
