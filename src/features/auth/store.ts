import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

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
   * Somebody who started signing up through "Run a place? Put it on the map"
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
  setSession: (session: Session | null) => void;
  setInitialized: () => void;
  recoveryStarted: () => void;
  recoveryReady: () => void;
  recoveryFailed: (message: string) => void;
  endRecovery: () => void;
  listingStarted: () => void;
  listingDone: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  initialized: false,
  recovery: null,
  listingIntent: false,
  setSession: (session) => set({ session }),
  setInitialized: () => set({ initialized: true }),
  recoveryStarted: () => set({ recovery: { status: 'establishing', message: null } }),
  recoveryReady: () => set({ recovery: { status: 'ready', message: null } }),
  recoveryFailed: (message) => set({ recovery: { status: 'failed', message } }),
  endRecovery: () => set({ recovery: null }),
  listingStarted: () => set({ listingIntent: true }),
  listingDone: () => set({ listingIntent: false }),
}));
