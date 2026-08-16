import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Fail loudly in dev if env wiring is missing, but don't crash the module load —
// Phase 0 must run from a fresh clone before a Supabase project exists.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured && __DEV__) {
  console.warn(
    'Supabase env vars missing. Copy .env.example to .env and fill in ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: {
      // Phase 1 will swap in expo-secure-store-backed storage for session
      // persistence; AsyncStorage-style persistence is a no-op until then.
      autoRefreshToken: true,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
);
