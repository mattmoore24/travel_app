import { act, render } from '@testing-library/react-native';
import { useEffect, useRef } from 'react';
import { Text } from 'react-native';
import { create } from 'zustand';

/**
 * The map's intent replay (map-screen.tsx, "THE REPLAY ITSELF") consumes the
 * intent FIRST and acts on it one tick later. Those two facts fight: a store
 * write inside a passive effect re-renders the component before React
 * returns to the event loop, so an effect that owns its timer through a
 * cleanup keyed on the intent has that cleanup run - and the timer cleared -
 * before a 0ms timer can fire. The replay cancelled itself by recording
 * that it had happened, and the onboarding tour's tail was red for four
 * runs while every guard around it read correctly.
 *
 * Two shapes of the same effect, on the real React and the real store. The
 * first is the one the map used to have and documents why it can never
 * work; the second is the one it has now. If React ever changes the first
 * result, the second still has to hold - and that is the one that matters.
 */

type Store = { intent: string | null; handled: () => void };

function makeStore() {
  return create<Store>((set) => ({
    intent: 'drop-pin',
    handled: () => set({ intent: null }),
  }));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

test('a cleanup keyed on the intent cancels the replay it was about to run', async () => {
  const useStore = makeStore();
  const fired: string[] = [];
  function CleanupOwned() {
    const intent = useStore((s) => s.intent);
    const handled = useStore((s) => s.handled);
    useEffect(() => {
      if (intent == null) {
        return;
      }
      handled();
      const timer = setTimeout(() => fired.push(intent), 0);
      return () => clearTimeout(timer);
    }, [intent, handled]);
    return <Text>{intent ?? 'none'}</Text>;
  }
  render(<CleanupOwned />);
  await settle();
  expect(useStore.getState().intent).toBeNull();
  expect(fired).toEqual([]);
});

test('a timer held in a ref, cleared on unmount only, outlives the clear', async () => {
  const useStore = makeStore();
  const fired: string[] = [];
  function RefOwned() {
    const intent = useStore((s) => s.intent);
    const handled = useStore((s) => s.handled);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
      () => () => {
        if (timer.current != null) {
          clearTimeout(timer.current);
        }
      },
      []
    );
    useEffect(() => {
      if (intent == null) {
        return;
      }
      handled();
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.push(intent);
      }, 0);
    }, [intent, handled]);
    return <Text>{intent ?? 'none'}</Text>;
  }
  const screen = render(<RefOwned />);
  await settle();
  expect(useStore.getState().intent).toBeNull();
  expect(fired).toEqual(['drop-pin']);
  // And exactly once: consuming the intent re-ran the effect, which must
  // not have scheduled a second tick.
  await settle();
  expect(fired).toEqual(['drop-pin']);
  screen.unmount();
});

test('unmounting before the tick lets it go', async () => {
  const useStore = makeStore();
  const fired: string[] = [];
  function RefOwned() {
    const intent = useStore((s) => s.intent);
    const handled = useStore((s) => s.handled);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
      () => () => {
        if (timer.current != null) {
          clearTimeout(timer.current);
        }
      },
      []
    );
    useEffect(() => {
      if (intent == null) {
        return;
      }
      handled();
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.push(intent);
      }, 0);
    }, [intent, handled]);
    return <Text>{intent ?? 'none'}</Text>;
  }
  const screen = render(<RefOwned />);
  screen.unmount();
  await settle();
  expect(fired).toEqual([]);
});
