import { MutationCache, QueryCache, QueryClient, focusManager } from '@tanstack/react-query';
import { Alert, AppState, Platform } from 'react-native';

import { isOffline, saveFailureMessage } from '@/lib/failure-message';

// Typed once here so every useMutation can carry `meta: { failureTitle }`
// without a cast. React Query reads this Register interface for the meta
// types across the app.
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /**
       * The title of the failure alert, said in the mutation's own verb —
       * "Couldn't send that", "Could not block them" — so the alert names
       * the act that failed instead of the generic "Could not save".
       */
      failureTitle?: string;
      /**
       * The screen already renders this failure under the control that
       * caused it, so the cache must not alert as well. The founder got one
       * refusal twice over: an inline line under the field AND a popup
       * saying the same sentence. Only set it where a catch or an onError
       * ALWAYS writes the message somewhere the person is already looking.
       */
      inlineFailure?: boolean;
    };
  }
}

/**
 * Whether the app's last attempt to reach the server got there.
 *
 * This is an OBSERVATION, not a reading of the radio. The app for people on
 * hostel wifi, airport wifi and a Thai SIM had no concept of being offline at
 * all: queries fired into a dead connection, retried twice, failed, and sat
 * there while every screen printed its own version of the same sentence.
 * Nothing told anybody the phone was the problem before they tapped, and the
 * only way back was to kill the app, which nobody was told either.
 *
 * The obvious fix is `@react-native-community/netinfo` wired into React
 * Query's `onlineManager`, which is what the plan asks for. That package is
 * NOT installed, it is a native module, and adding it spends an EAS build —
 * so this is the version that ships over the air, built on what the app
 * already knows. It costs two things, both of them named here so nobody
 * mistakes this for the finished article:
 *
 *   - We learn the connection is gone by TRYING, so the banner appears on the
 *     first failed request rather than the moment the wifi drops.
 *   - We learn it is back the same way, which is why `probeForReconnect`
 *     below exists at all. A radio listener would need neither.
 *
 * `onlineManager` is deliberately left alone. Telling React Query it is
 * offline PAUSES every query instead of failing it, and a paused query is
 * `pending` forever: any screen with an error branch and no loading branch
 * would go from showing an honest failure to showing nothing at all. That
 * trade is worth making WITH a radio listener, once those screens have
 * loading states. It is not worth making with a guess.
 */
export type ConnectionStatus = 'online' | 'offline';

/**
 * Optimistic on purpose. The first thing the app does is fetch, so a wrong
 * guess here is corrected within a second, and the wrong guess that costs
 * nothing is the one that shows no banner.
 */
let connectionStatus: ConnectionStatus = 'online';
const connectionListeners = new Set<() => void>();

export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus;
}

/** `useSyncExternalStore`'s half of the contract. See `connection-banner`. */
export function subscribeToConnection(listener: () => void): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

/**
 * How long to wait before asking the screen's own queries to try again, and
 * how far that backs off.
 *
 * Something has to generate traffic while we are offline or nothing can ever
 * succeed and the banner never clears. Doubling from four seconds to a
 * half-minute ceiling keeps the recovery quick for the common case (a lift, a
 * tunnel, a station platform) without a phone in a dead zone retrying every
 * few seconds for an afternoon. Foregrounding the app recovers faster still
 * and for free: the AppState bridge at the bottom of this file already tells
 * `focusManager`, which refetches on its own.
 */
const PROBE_FROM_MS = 4_000;
const PROBE_CEILING_MS = 30_000;
let probeDelay = PROBE_FROM_MS;
let probeTimer: ReturnType<typeof setTimeout> | null = null;

function probeForReconnect(): void {
  if (probeTimer != null) return;
  probeTimer = setTimeout(() => {
    probeTimer = null;
    if (connectionStatus !== 'offline') return;
    probeDelay = Math.min(probeDelay * 2, PROBE_CEILING_MS);
    // The mounted screen's own queries, so a recovery refetches exactly what
    // the person is looking at. Failures here are ordinary query failures and
    // are already handled by whatever rendered them.
    void queryClient.refetchQueries({ type: 'active' });
    probeForReconnect();
  }, probeDelay);
  // Node only (jest). A pending probe must not be the reason a test run hangs.
  (probeTimer as unknown as { unref?: () => void }).unref?.();
}

/**
 * What every finished request tells us. `null` means it succeeded.
 *
 * `isOffline` is the same classifier that decides whether a person is told
 * "No connection" or "Something went wrong", which is the point: the bar
 * under the notch and the sentence on the screen have to agree, or they read
 * as two separate faults. It errs generously (a bare `TypeError` counts), and
 * that generosity is already shipped in the copy — this makes it visible
 * rather than making it worse.
 */
function noteRequestOutcome(error: unknown, from?: object): void {
  const next: ConnectionStatus = error != null && isOffline(error) ? 'offline' : 'online';
  if (error != null && next === 'online') {
    // A server-side failure (a raised exception, a 403) proves the request
    // ARRIVED, so it is evidence of a connection just as much as a success.
    // Anything else that failed for a reason we cannot classify tells us
    // nothing, and "nothing" must not clear the banner.
    if (!wasReachable(error)) return;
  }
  if (next === connectionStatus) return;
  connectionStatus = next;
  if (next === 'online') {
    probeDelay = PROBE_FROM_MS;
    if (probeTimer != null) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    // Everything the app is showing was fetched before the connection came
    // back, or failed while it was gone. This is the refetch-on-reconnect
    // that wiring `onlineManager` would have given for free; excluding the
    // query that just proved we are back saves fetching it twice.
    void queryClient.invalidateQueries({ predicate: (query) => (query as object) !== from });
  } else {
    probeForReconnect();
  }
  for (const listener of connectionListeners) listener();
}

/** Did this failure come back FROM the server? Then the connection is fine. */
function wasReachable(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  const code = (error as { code?: unknown })?.code;
  return typeof status === 'number' ? status > 0 : typeof code === 'string';
}

export const queryClient = new QueryClient({
  // Every finished query is evidence about the connection, so the banner is
  // driven by the traffic the app was making anyway rather than by a poll of
  // its own.
  queryCache: new QueryCache({
    onError: (error, query) => noteRequestOutcome(error, query),
    onSuccess: (_data, query) => noteRequestOutcome(null, query),
  }),
  // Mutations that individual screens don't handle still surface to the user
  // instead of failing silently (review finding: onboarding saves swallowed
  // network errors). Screens keep flow control via try/catch around
  // mutateAsync; this cache handler owns the messaging.
  mutationCache: new MutationCache({
    // A save that never left the phone is the loudest evidence there is that
    // the connection is gone, and it is the moment somebody most needs to be
    // told the phone is the problem rather than what they typed.
    onSuccess: () => noteRequestOutcome(null),
    onError: (error, _variables, _context, mutation) => {
      // Before the opt-out, never after: the connection banner reads every
      // outcome, and a screen that prints its own failure still proves the
      // phone is online.
      noteRequestOutcome(error);
      if (mutation.meta?.inlineFailure) {
        return;
      }
      // Duck-typed, not instanceof: PostgREST hands back a plain object, so
      // an instanceof check discarded every message the database sent and
      // showed "Something went wrong." for all of them. Real Error
      // subclasses (AuthError, StorageError) carry .message too.
      //
      // What the message must never be is the raw string. saveFailureMessage
      // owns the vocabulary (UX_PLAN.md D3: the database may not write
      // user-facing copy): a stable hint code or a known fragment gets a
      // written sentence, a real sentence the database wrote passes through,
      // and everything else — the transport's own words included — becomes
      // the generic one.
      const message = saveFailureMessage(error);
      const title = mutation.meta?.failureTitle ?? 'Could not save';
      if (Platform.OS === 'web') {
        // react-native-web's Alert is a silent no-op; use the browser dialog.
        (globalThis as { alert?: (msg: string) => void }).alert?.(`${title}: ${message}`);
      } else {
        Alert.alert(title, message);
      }
    },
  }),
  defaultOptions: {
    queries: {
      // Travel data (trips, pins, heatmap) tolerates short staleness; screens
      // that need realtime freshness (chat) will use Supabase Realtime instead.
      staleTime: 30_000,
      retry: 2,
    },
  },
});

// React Query's "window focus" doesn't exist in RN — wire it to AppState so
// errored/stale queries (profile fetch, signed photo URLs) refetch when the
// app foregrounds.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
}
