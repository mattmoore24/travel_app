import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/lib/database.types';
import { SecureSessionStore } from '@/lib/secure-session-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Fail loudly in dev if env wiring is missing, but don't crash the module load —
// the app must run from a fresh clone before a Supabase project exists.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured && __DEV__) {
  console.warn(
    'Supabase env vars missing. Copy .env.example to .env and fill in ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

/**
 * How long one PostgREST request may take before the client gives up on it.
 *
 * Twenty seconds is set by the slowest real query (a long thread page on a
 * hostel link), not by the boot ones. It applies to `.from()` and `.rpc()`
 * only: storage uploads and auth have their own clocks, so a photo on 3G is
 * untouched.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

export const supabase = createClient<Database>(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: {
      // Native sessions: AES key in the iOS keychain, ciphertext in
      // AsyncStorage. Web (dev convenience) uses supabase-js's default
      // localStorage handling.
      storage: Platform.OS === 'web' ? undefined : new SecureSessionStore(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    // Both of these are invisible from the app's own source, and both were
    // costing the offline cold start most of its blank screen.
    //
    // postgrest-js retries every GET three times on its own (1s, 2s, 4s)
    // before React Query hears a word, and React Query then retried twice
    // more on top: in airplane mode a signed-in person looked at the splash
    // colour for ~24 seconds before anything said "No connection". Retrying a
    // request that never left the phone buys nothing; the connection store
    // in lib/query-client re-probes and refetches on reconnect, and React
    // Query still retries the failures that DID reach the server (the 503
    // schema-cache moment after a deploy, which is what postgrest's retry
    // was for).
    //
    // Without a timeout a request on wifi with no upstream (a hotel captive
    // portal, the commonest case on the road) waits on iOS's 60-second
    // default, per attempt. An aborted request comes back as
    // `{ status: 0, message: 'AbortError: ...' }`, which
    // lib/failure-message's isOffline already reads as "never arrived".
    db: { retry: false, timeout: REQUEST_TIMEOUT_MS },
  }
);

/**
 * How long the boot probe waits for any answer at all. Shorter than the
 * request budget above because it carries nothing: a HEAD that has not come
 * back in ten seconds is a link nothing else will get through either.
 */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * "The request never reached the server", in the shape the rest of the app
 * already recognises: lib/failure-message's isOffline reads `status: 0` as
 * offline before it looks at the message, which is also what postgrest-js
 * hands back for an aborted request.
 */
export class ServerUnreachable extends Error {
  readonly status = 0;

  constructor(message: string) {
    super(message);
    this.name = 'ServerUnreachable';
  }
}

/**
 * One HEAD to PostgREST's root, to learn whether the server is there.
 *
 * On a cold start nothing else is in flight while auth-js is still deciding
 * whether the persisted session is fresh, and on a stale token that decision
 * backs off for ~25 seconds offline. This runs from the first frame instead,
 * through React Query, so it feeds the same connection store as every other
 * request (lib/query-client) and the offline card can say so within a second.
 *
 * It RESOLVES on any HTTP response, a 401 from the wrong key included: an
 * answer of any kind proves the server was reached, and the status code is
 * the caller's evidence. It throws only when nothing came back.
 */
export async function probeServer(): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${supabaseUrl ?? ''}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: supabaseAnonKey ?? '' },
      signal: controller.signal,
    });
    return response.status;
  } catch (error) {
    throw new ServerUnreachable(
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
  } finally {
    clearTimeout(timer);
  }
}

// Refresh tokens only while the app is foregrounded (Supabase-recommended).
if (Platform.OS !== 'web' && isSupabaseConfigured) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
