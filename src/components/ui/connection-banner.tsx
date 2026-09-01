import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Elevation, HitTarget, Motion, Radius, Space, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { NO_CONNECTION } from '@/lib/failure-message';
import { getConnectionStatus, subscribeToConnection } from '@/lib/query-client';

/**
 * The one place the app says "the phone is the problem, not you".
 *
 * This is an app for people on hostel wifi, airport wifi and a Thai SIM. A
 * traveler who walks out of the cafe halfway through a conversation used to
 * get an app that was quietly wrong: queries failing into a dead connection,
 * each screen printing its own version of the same sentence, nothing saying
 * the connection was gone and nothing noticing when it came back.
 *
 * The bar answers exactly two questions and then goes away. "No connection"
 * while the app cannot reach the server, "Back online" for a second and a
 * half when it can again — the second half matters as much as the first,
 * because without it the only evidence of recovery is a bar that vanished
 * while you were not looking.
 *
 * Where it renders is part of the design, not an afterthought. It belongs at
 * the ROOT, as a sibling of the navigator, not inside `(tabs)`: chat/[id],
 * place/[id], room/[id] and every modal live outside the tabs, and those are
 * exactly the screens somebody is on when the wifi goes. Top rather than
 * bottom, so it never collides with the map's drop-a-pin control or the
 * floating tab bar.
 *
 * `pointerEvents="none"` on the container is load-bearing. An
 * absolutely-positioned overlay that swallows touches is the same class of
 * bug the traps skill records for iOS's ModalHostView: nothing is visibly
 * wrong, and every tap under it silently does nothing.
 *
 * Its two words come from `NO_CONNECTION` in lib/failure-message rather than
 * being written here, because the bar and a screen's own failure message are
 * usually on screen together.
 */

/** How long "Back online" stays before the bar dismisses itself. */
const RESTORED_MS = 1_500;

type Phase = 'hidden' | 'offline' | 'restored';

/**
 * The bar's own state machine, kept OUTSIDE React on purpose.
 *
 * It is a transition machine — "was offline, is online now" — and the honest
 * shape of that is a subscription, not a render. Written as effects it would
 * be a `setState` inside `useEffect` per transition, which is both the
 * cascading-render pattern the React Compiler lint rejects and a worse
 * description of what is happening. `components/ui/sheet.tsx` keeps its
 * presented-modal count the same way.
 */
let phase: Phase = 'hidden';
const phaseListeners = new Set<() => void>();
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let unwatchConnection: (() => void) | null = null;

function clearRestoreTimer(): void {
  if (restoreTimer == null) return;
  clearTimeout(restoreTimer);
  restoreTimer = null;
}

function setPhase(next: Phase): void {
  if (next === phase) return;
  phase = next;
  // Spoken, not only drawn — the same rule and the same mechanism as
  // components/ui/load-error.tsx. VoiceOver hears nothing when a bar appears
  // above the content it is reading, and somebody offline with a screen
  // reader gets the least out of a silent failure. Announced on the
  // TRANSITION rather than on every render, which is the other reason this
  // machine is not a pile of effects.
  if (next !== 'hidden') announce(labelFor(next));
  for (const listener of phaseListeners) listener();
}

function announce(what: string): void {
  AccessibilityInfo.isScreenReaderEnabled()
    .then((on) => {
      if (on) AccessibilityInfo.announceForAccessibility(what);
    })
    .catch(() => {});
}

function onConnectionChanged(): void {
  if (getConnectionStatus() === 'offline') {
    clearRestoreTimer();
    setPhase('offline');
    return;
  }
  // Coming back is only worth marking to somebody who saw it go. An app that
  // has been connected the whole time must not flash a bar because one query
  // happened to succeed.
  if (phase !== 'offline') return;
  setPhase('restored');
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    setPhase('hidden');
  }, RESTORED_MS);
  // Node only (jest). A pending dismissal must not hold a test run open.
  (restoreTimer as unknown as { unref?: () => void }).unref?.();
}

function subscribeToPhase(listener: () => void): () => void {
  if (unwatchConnection == null) {
    // First mount: take the current truth rather than whatever the last one
    // left behind. There is no "back online" to show for a change nobody was
    // watching.
    clearRestoreTimer();
    phase = getConnectionStatus() === 'offline' ? 'offline' : 'hidden';
    unwatchConnection = subscribeToConnection(onConnectionChanged);
  }
  phaseListeners.add(listener);
  return () => {
    phaseListeners.delete(listener);
    if (phaseListeners.size > 0) return;
    unwatchConnection?.();
    unwatchConnection = null;
    clearRestoreTimer();
  };
}

const readPhase = (): Phase => phase;

const labelFor = (current: Phase): string =>
  current === 'restored' ? 'Back online' : NO_CONNECTION;

export function ConnectionBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const current = useSyncExternalStore(subscribeToPhase, readPhase, readPhase);

  if (current === 'hidden') return null;

  return (
    // BELOW the top control row, not on it. The map is the default screen and
    // it floats its city bar and avatar at `insets.top + Spacing.two` with a
    // 44pt hit target; an opaque pill at `insets.top + Space.xs` landed
    // directly on both — and because this container is pointerEvents="none"
    // they stayed TAPPABLE while being invisible, which is the worst version
    // of that bug. Clearing the row derives the offset from the same two
    // constants the map uses rather than hardcoding a number, and it lands
    // just under a native navigation header on the pushed screens too.
    <View
      style={[styles.root, { top: insets.top + Spacing.two + HitTarget + Space.xs }]}
      pointerEvents="none">
      <Animated.View
        entering={FadeIn.duration(Motion.quick)}
        // Amber for the fault and green for its repair, never danger: red is
        // banned as a UI colour here, and this is not a destructive event —
        // it is a fact about the room the traveler walked into. Both grounds
        // take `canvas` for their text: 11.8:1 on warning, 11.1:1 on success.
        style={[
          styles.bar,
          { backgroundColor: current === 'restored' ? theme.success : theme.warning },
        ]}
        accessibilityLiveRegion="polite">
        <ThemedText type="caption" style={{ color: theme.canvas }}>
          {labelFor(current)}
        </ThemedText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    // Logical, not `left`/`right`. Nothing in this app mirrors yet and one
    // new file will not change that, but the retrofit only ever gets bigger,
    // and scripts/__tests__/logical-directional-styles.test.ts is the scan
    // that keeps new work on this side of the line.
    start: 0,
    end: 0,
    alignItems: 'center',
    // Above the navigator's own content. It has no siblings to fight with at
    // the root, so one is enough.
    zIndex: 1,
  },
  bar: {
    // On the 4pt grid, and wider than it is tall: this is a status pill under
    // the notch, not a system-wide slab. Nothing fixes its height, so it grows
    // with Dynamic Type instead of clipping its own label.
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    ...Elevation.floating,
  },
});
