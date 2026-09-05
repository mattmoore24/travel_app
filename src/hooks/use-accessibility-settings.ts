import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The two OS accessibility switches the app reacts to, read once and shared.
 *
 * One subscription for the whole app rather than one per component: the
 * values live in module state, every mounted hook re-renders on a change
 * (useSyncExternalStore, the same pattern the sheet counter uses), and the
 * OS listeners are attached on first use. Reanimated's own `useReducedMotion`
 * covers worklet animations; this hook is for the work Reanimated does not
 * see - map camera flights, and the glass surface's opaque fallback under
 * Reduce Transparency.
 *
 * Both start false and correct themselves on the first async read: a frame
 * of animation before the answer arrives is the harmless direction of error,
 * while blocking a first paint on AccessibilityInfo is not.
 */
type Settings = { reduceMotion: boolean; reduceTransparency: boolean };

let current: Settings = { reduceMotion: false, reduceTransparency: false };
const listeners = new Set<() => void>();
let started = false;

function publish(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  for (const listener of listeners) {
    listener();
  }
}

function start(): void {
  if (started) {
    return;
  }
  started = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => publish({ reduceMotion: on }))
    .catch(() => {});
  AccessibilityInfo.isReduceTransparencyEnabled()
    .then((on) => publish({ reduceTransparency: on }))
    .catch(() => {});
  // Change subscriptions live for the app's lifetime on purpose: these are
  // process-wide OS settings, not per-screen state.
  AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => publish({ reduceMotion: on }));
  AccessibilityInfo.addEventListener('reduceTransparencyChanged', (on) =>
    publish({ reduceTransparency: on })
  );
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): Settings {
  return current;
}

export function useAccessibilitySettings(): Settings {
  return useSyncExternalStore(subscribe, read, read);
}
