import { useIsFetching, useQuery } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass-surface';
import { HitTarget, MaxContentWidth, Motion, Radius, Space, Spacing } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/store';
import { retrySession } from '@/features/auth/use-auth-listener';
import { NO_CONNECTION } from '@/lib/failure-message';
import {
  getConnectionStatus,
  getEverReached,
  queryClient,
  subscribeToConnection,
  subscribeToReach,
} from '@/lib/query-client';
import { isSupabaseConfigured, probeServer } from '@/lib/supabase';

/**
 * The card somebody sees when the app opens with no internet.
 *
 * Before it, an offline cold start was the splash colour and nothing else:
 * the root holds the navigator until the persisted session and the boot
 * reads settle (features/auth/routing), and in airplane mode that took ~24
 * seconds of retries stacked three layers deep, then an account error screen
 * with a Sign out on it. On a wifi with no upstream it was twelve minutes.
 * The founder's ask was a small popup saying the phone is not connected,
 * with a button to try again, instead of the blank screen.
 *
 * It is a CARD as a sibling of the navigator, never a Modal and never
 * returned in the navigator's place. A Modal presented on a data event
 * rather than a tap is the presentation iOS drops (traps: ModalHostView),
 * and replacing the navigator is the root-hold trap the layout's comments
 * record. Drawn here it sits over the boot hold, over the guest map, over
 * the intro tour and over anything else, and it lives at the root because
 * being offline outlives whatever screen somebody is on.
 *
 * It owns the COLD phase only: it shows while nothing has reached the server
 * since launch (`everReached` in lib/query-client) and the app has either
 * observed a failure that never left the phone or waited SLOW_START_MS with
 * no answer at all. The moment anything gets through it unmounts, for good,
 * and the pill under the notch (connection-banner) is the voice from then on.
 * One fact, one voice at a time.
 *
 * The container is `pointerEvents="box-none"` and the card itself takes the
 * touches. An absolutely-positioned sibling that swallows taps is the
 * invisible-overlay bug the traps skill records, and the map behind this on a
 * guest's start has its own Try again that must stay reachable.
 *
 * Nothing here has a fixed height or a cap on its lines: the root is measured
 * at AX5 by the large-text tour, and this is the first thing a new person
 * sees. The card grows; the title wraps.
 */

/**
 * How long a cold start may stay silent before the card says so on its own.
 *
 * The offline verdict is normally observed within a second (the boot probe
 * below fails at once in airplane mode). This is for the link that HANGS, a
 * hotel wifi with no upstream: nothing fails, nothing succeeds, and without a
 * clock the person would wait out the request budget on a bare splash colour.
 */
const SLOW_START_MS = 8_000;

const OFFLINE_BODY =
  'Samewhere needs the internet to open. Check wifi or mobile data, then try again.';
const SLOW_BODY = 'Still trying to connect. Check wifi or mobile data, then try again.';

/** Exported for the copy test: every sentence this card can say. */
export const OFFLINE_NOTICE_COPY = [NO_CONNECTION, OFFLINE_BODY, SLOW_BODY, 'Try again'];

/**
 * One HEAD to the server from the first frame, through React Query, so its
 * outcome feeds the same connection store as every other request.
 *
 * It exists because nothing else is in flight during the one stretch that
 * matters most: on a stale token auth-js backs off for ~25 seconds before
 * `initialized` flips, and every boot query is disabled until then, so the
 * store had no evidence and the card had nothing to go on but its clock.
 * Disabled for good once anything has reached the server; `gcTime: 0` so a
 * spent probe does not sit in the cache.
 */
function useBootProbe(everReached: boolean) {
  useQuery({
    queryKey: ['boot-probe'],
    queryFn: probeServer,
    enabled: isSupabaseConfigured && !everReached,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function OfflineNotice() {
  const insets = useSafeAreaInsets();
  const everReached = useSyncExternalStore(subscribeToReach, getEverReached, getEverReached);
  const status = useSyncExternalStore(
    subscribeToConnection,
    getConnectionStatus,
    getConnectionStatus
  );
  const sessionUnknown = useAuthStore((s) => s.sessionUnknown);
  // Every query the app has in flight, not only the boot ones: while the
  // button spins the app is trying, and that is the truth the spinner tells.
  const fetching = useIsFetching();
  const [slow, setSlow] = useState(false);

  useBootProbe(everReached);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => clearTimeout(timer);
  }, []);

  // Not on an unconfigured app (a fresh clone with no .env): nothing can ever
  // reach a server that is not there, and a card saying so would be the app's
  // permanent first screen in development.
  const visible = isSupabaseConfigured && !everReached && (status === 'offline' || slow);

  // Spoken, not only drawn: the same rule and mechanism as
  // components/ui/load-error. Announced when the card appears, guarded so it
  // does no work when no screen reader is running.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (on && live) AccessibilityInfo.announceForAccessibility(NO_CONNECTION);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [visible]);

  if (!visible) return null;

  const retry = () => {
    // The active queries: during the hold that is the boot probe and the
    // four boot reads in RootNavigator, on the guest map it is the cities
    // and the pins. Exactly what the person is waiting on, nothing else.
    void queryClient.refetchQueries({ type: 'active' });
    // And the session, when the session is what could not be checked. Not
    // otherwise: a known session needs no second look.
    if (sessionUnknown) void retrySession();
  };

  return (
    // The same offset as the pill: below the map's top control row, which
    // floats at insets.top + Spacing.two with a 44pt target. The row stays
    // tappable through the box-none container above the card.
    <View
      style={[styles.root, { top: insets.top + Spacing.two + HitTarget + Space.xs }]}
      pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(Motion.quick)} style={styles.frame}>
        <GlassSurface radius={Radius.lg} style={styles.card}>
          <ThemedText type="title">{NO_CONNECTION}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {status === 'offline' ? OFFLINE_BODY : SLOW_BODY}
          </ThemedText>
          {/* The app's word for the founder's "Retry": the same label the
              account error screen and every LoadError already use, so the
              act has one name wherever it appears. */}
          <PrimaryButton label="Try again" loading={fetching > 0} onPress={retry} />
        </GlassSurface>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    // Logical, not `left`/`right`, for the same reason the pill is: the RTL
    // retrofit only ever gets bigger.
    start: 0,
    end: 0,
    alignItems: 'center',
    paddingHorizontal: Space.lg,
    // Above the navigator's own content, level with the pill; the two are
    // never on screen together.
    zIndex: 1,
  },
  frame: {
    alignSelf: 'stretch',
    maxWidth: MaxContentWidth,
  },
  card: {
    padding: Space.lg,
    gap: Space.md,
  },
});
