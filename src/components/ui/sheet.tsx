import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  SlideOutDown,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Elevation, MaxContentWidth, Motion, Radius, Space, Springs } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * How long a Sheet takes to leave, from its exiting animation below. Anything
 * that has to wait for the sheet to be gone reads it from here so the two
 * cannot drift apart.
 */
export const SHEET_EXIT_MS = 320;

/**
 * How long to leave between one native modal going and the next arriving.
 *
 * iOS presents one modal at a time and silently DROPS a presentation that
 * begins while another is still dismissing. Unmounting in React is not the
 * same as dismissed on screen, so a counter alone is not enough — anything
 * presenting on its own schedule has to wait out the teardown as well. The
 * map has used this number since a freshly dropped pin came back with no
 * confirmation card at all; it lives here now so there is one of it.
 */
export const SHEET_SETTLE_MS = 450;

/** How far down you have to pull before letting go dismisses. */
const DISMISS_DISTANCE = 90;

/**
 * How many native-modal Sheets are mounted right now, and a way to watch it.
 *
 * Only the push primer needs this: it is the one thing in the app that
 * presents a sheet on a schedule of its own — the moment a hello is
 * delivered or a pin is posted — rather than because somebody tapped
 * something. Both of those moments happen while another sheet is on its way
 * out, which is exactly the presentation iOS drops.
 */
let presentedSheets = 0;
const sheetListeners = new Set<() => void>();

function readPresentedSheets(): number {
  return presentedSheets;
}

function subscribeToSheets(listener: () => void): () => void {
  sheetListeners.add(listener);
  return () => {
    sheetListeners.delete(listener);
  };
}

function setPresentedSheets(next: number): void {
  presentedSheets = Math.max(0, next);
  for (const listener of sheetListeners) {
    listener();
  }
}

/** How many native modals are mounted. Inline sheets do not count. */
export function usePresentedSheetCount(): number {
  return useSyncExternalStore(subscribeToSheets, readPresentedSheets, readPresentedSheets);
}

/**
 * Declare that this component owns the screen — a `<Sheet>`, or a raw
 * `<Modal>` standing in for one.
 *
 * Sheet calls it for itself. Anything else rendering a raw `<Modal>` should
 * call it too, or the count is a lie and whatever is waiting on it presents
 * into a collision anyway.
 */
export function useRegisterNativeModal(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    setPresentedSheets(presentedSheets + 1);
    return () => {
      setPresentedSheets(presentedSheets - 1);
    };
  }, [active]);
}
/** Or how fast, for a flick that never travels that far. */
const DISMISS_VELOCITY = 900;

/**
 * Never push a route from inside a presented Sheet. The route goes into the
 * stack BELOW it while the sheet's full-screen scrim survives, so when the
 * person comes back every tap lands on an invisible overlay and the screen
 * looks dead. That is the map freeze the founder reported.
 *
 * Wrap the navigation in this instead: it dismisses the sheet first and goes
 * once the sheet has finished leaving.
 */
export function leavingSheet(close: () => void) {
  return (go: () => void) => {
    close();
    setTimeout(go, SHEET_EXIT_MS);
  };
}

/**
 * The default container for anything that doesn't deserve a full screen —
 * previews, detail, confirmations (docs/DESIGN.md; it's the 2026 convention
 * and what iOS standardised). Tap-outside dismisses, and the grabber is now
 * a real handle: pull it down (or flick it) and the sheet goes.
 */
export function Sheet({
  children,
  onClose,
  dimmed = true,
  avoidKeyboard = false,
  inline = false,
}: {
  children: ReactNode;
  onClose: () => void;
  dimmed?: boolean;
  /** Lift the sheet above the keyboard — for sheets that contain inputs. */
  avoidKeyboard?: boolean;
  /**
   * Render WITHOUT the Modal wrapper, so whatever is behind the sheet stays
   * live to touch.
   *
   * A native modal creates its own window: it swallows every touch outside
   * the sheet no matter what pointerEvents says, which is exactly right for
   * a confirmation and exactly wrong for a card sitting over a map you are
   * still meant to be able to pan.
   *
   * The cost is that an inline sheet positions itself against its PARENT
   * rather than the screen, so it may only be used where the caller renders
   * it as a direct child of a full-screen root (the map does; a dropdown
   * inside a scrolling form does not, which is what the Modal is there for).
   */
  inline?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const sheetWidth = Math.min(width, MaxContentWidth);
  const keyboard = useAnimatedKeyboard();
  const drag = useSharedValue(0);

  // The entrance is a TRANSFORM, not Reanimated's slide-in preset.
  //
  // The Slide family animates the view's real LAYOUT — `originY`, not
  // translateY — and for as long as one runs Reanimated re-applies the frame
  // it SNAPSHOTTED when the animation began, once per frame, width and height
  // included. A sheet whose content arrives after it opens (a query
  // resolving, a photo signing, a skeleton giving way to a card) therefore
  // lands at the size it had at the moment of the tap and stays there. That is
  // the place card that opened a third of the way and needed closing and
  // re-tapping to come up whole: the second tap was served from cache, so the
  // snapshot was of the finished card.
  //
  // Sliding by `translateY` leaves the layout entirely to React Native, so the
  // sheet grows the instant its content does, mid-entrance or long after. Fade
  // and Zoom are clear of this — they animate opacity and transform, so their
  // frame never overrides anything, which is why the scrim below keeps one.
  const enter = useSharedValue(1);
  useEffect(() => {
    enter.value = withSpring(0, Springs.sheet);
  }, [enter]);

  // Register while this sheet owns the screen, so anything that would present
  // one of its own waits its turn. Inline sheets count too: nothing can
  // collide with them, but they are still what somebody is looking at, and
  // the primer arriving over the confirmation card for the pin you just
  // dropped is a fair question asked at the worst moment.
  useRegisterNativeModal(true);

  // Down only: dragging up would let a sheet leave its own bottom edge, and
  // the rubber-band there reads as a bug rather than as resistance.
  const pull = Gesture.Pan()
    .onUpdate((event) => {
      drag.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      // Reset either way. On dismissal the sheet is normally unmounted by
      // the caller, but a caller that keeps it mounted must not be left with
      // a sheet parked halfway off the screen.
      drag.value = withSpring(0, Springs.release);
      if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(onClose)();
      }
    });

  // A bottom-anchored sheet should make room for the keyboard, not slide up
  // over it. Translating worked for short sheets and failed badly for tall
  // ones — either the top ran off the screen, or (once clamped) it could not
  // move at all and its own button stayed buried. Growing the bottom padding
  // pushes the content up by exactly the keyboard's height, and the cap
  // below lets a long form's scroll area shrink instead of overflowing.
  const keyboardStyle = useAnimatedStyle(() => {
    const lift = avoidKeyboard ? keyboard.height.value : 0;
    return {
      // max, not a sum. The keyboard is measured from the bottom of the
      // SCREEN, so its height already spans the home indicator — adding the
      // safe-area inset on top reserved that strip twice and left a band of
      // dead sheet between the last control and the keyboard, on the one
      // screen whose scroll area is being starved to make room for it.
      paddingBottom: Math.max(insets.bottom, lift) + Space.lg,
      // A full screen height below its resting place, then sprung home — the
      // same travel the preset used, without handing Reanimated the layout.
      transform: [{ translateY: drag.value + enter.value * height }],
    };
  });

  const body = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {dimmed ? (
        <Animated.View
          entering={FadeIn.duration(Motion.quick)}
          exiting={FadeOut.duration(Motion.quick)}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}>
          {/* "Dismiss", not "Close": sheets often contain their own Close
              button, and two identical labels are ambiguous to VoiceOver
              and to anything driving the app. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            style={StyleSheet.absoluteFill}
            onPress={onClose}
          />
        </Animated.View>
      ) : null}

      <Animated.View
        // Presentation is the iOS system-sheet spring (`Springs.sheet`:
        // SwiftUI response .55 / damping .825 converted) applied to the
        // transform above. Dismissal is quicker by convention, and it stays a
        // layout animation safely — nothing grows on the way out.
        exiting={SlideOutDown.duration(200)}
        style={[
          styles.sheet,
          Elevation.sheet,
          {
            width: sheetWidth,
            backgroundColor: theme.surface,
            maxHeight: height - insets.top - Space.lg,
          },
          keyboardStyle,
        ]}>
        {/* The grabber is the drag target, and it is deliberately taller
            than it looks: 4pt of visible bar inside a 24pt strip, because
            the affordance was advertising a gesture that did not exist. */}
        <GestureDetector gesture={pull}>
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            accessibilityHint="Or pull down"
            onAccessibilityTap={onClose}
            style={styles.grabberTarget}>
            <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />
          </View>
        </GestureDetector>
        {children}
      </Animated.View>
    </View>
  );

  if (inline) {
    return body;
  }

  return (
    // Through a Modal on purpose: a sheet is often rendered from deep inside
    // a form or a scroll view, and an absolutely-positioned root resolves
    // against its PARENT, not the screen — which anchored the gender
    // dropdown to its own field box and the trip editor to the bottom of the
    // profile's scroll content.
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      {/* A React Native Modal is hosted in its own native window, which sits
          outside the gesture root the navigator establishes — so without
          this, every gesture inside a sheet is dead. That covers the pull to
          dismiss here and the hours slider in the pin form. */}
      <GestureHandlerRootView style={styles.gestureRoot}>{body}</GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    gap: Space.md,
  },
  grabberTarget: {
    alignSelf: 'center',
    paddingHorizontal: Space.xl,
    paddingTop: Space.xs,
    paddingBottom: Space.sm,
    marginTop: -Space.xs,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
});
