import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

type AuthState = {
  /** Restored/live Supabase session; null = signed out. */
  session: Session | null;
  /** True once the initial getSession() has resolved (gate rendering on it). */
  initialized: boolean;
  setSession: (session: Session | null) => void;
  setInitialized: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  initialized: false,
  setSession: (session) => set({ session }),
  setInitialized: () => set({ initialized: true }),
}));
