import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
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

import { KeyboardDoneBar } from '@/components/form/keyboard-done-bar';
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
 * TWO counts, because two different questions are asked here and answering
 * both with one number is what made a photo tap dead.
 *
 * `presentedModals` is the COLLISION question: how many native `<Modal>`s are
 * up in this window right now. iOS presents one at a time and silently DROPS
 * a presentation that begins while another is dismissing, and on Fabric that
 * does not lose a modal — it leaves an invisible full-screen view answering
 * every hit test and the app is dead to touch until relaunch (traps). Only
 * something about to present a Modal of its own has any business reading it.
 *
 * `screenOwners` is the MANNERS question: is the person already looking at
 * something? An inline sheet counts here and not above. It has no Modal, so
 * there is nothing to collide with, but the map's pin card is still what
 * somebody is reading, and the push primer arriving over the confirmation for
 * the pin they just dropped is a fair question asked at the worst moment.
 *
 * One number served both until 2026-09-01, and the map paid for it: its pin
 * and venue cards are `<Sheet inline>` and nothing clears them on blur, so the
 * count sat at 1 on every screen the app went to afterwards — and the photo
 * viewer, which was watching it for a collision that could not happen, never
 * presented at all.
 */
type Count = {
  read: () => number;
  subscribe: (listener: () => void) => () => void;
  shift: (by: number) => void;
};

function createCount(): Count {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    shift: (by) => {
      value = Math.max(0, value + by);
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

const presentedModals = createCount();
const screenOwners = createCount();

function useCount(count: Count): number {
  return useSyncExternalStore(count.subscribe, count.read, count.read);
}

function useHold(count: Count, active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    count.shift(1);
    return () => count.shift(-1);
  }, [count, active]);
}

/**
 * How many native modals are presented right now — the number to read before
 * presenting one of your own. An inline sheet is not one of these.
 *
 * Exported for the tests rather than for a screen, deliberately: the
 * subscribing form is the wrong one for every real caller (see the read-once
 * form below and the reason under it), but a counter nothing can observe is a
 * counter nothing can hold to its word, and this one is load-bearing for
 * whether a photo viewer ever opens. sheet-counts.test.tsx and
 * photo-viewer.test.tsx read it to assert what the counter does.
 */
export function usePresentedModalCount(): number {
  return useCount(presentedModals);
}

/**
 * The same number, read once instead of watched.
 *
 * For a decision taken at a single moment — "was anything in the way when
 * this tap happened" — where subscribing would mean re-deciding later, on a
 * count that has since moved for reasons that have nothing to do with the tap.
 */
export function presentedModalCount(): number {
  return presentedModals.read();
}

/**
 * How many things own the screen right now, inline sheets included.
 *
 * Only the push primer needs this: it is the one thing in the app that
 * presents on a schedule of its own — the moment a hello is delivered or a
 * pin is posted — rather than because somebody tapped something, so it is the
 * only one that has to ask whether it is interrupting.
 */
export function useScreenOwnerCount(): number {
  return useCount(screenOwners);
}

/**
 * Declare that this component presents a native `<Modal>` — a `<Sheet>`, or a
 * raw `<Modal>` standing in for one.
 *
 * Sheet calls it for itself. Anything else rendering a raw `<Modal>` should
 * call it too, or the count is a lie and whatever is waiting on it presents
 * into a collision anyway. A native modal owns the screen as well, so this
 * registers in both counts.
 */
export function useRegisterNativeModal(active: boolean): void {
  useHold(presentedModals, active);
  useHold(screenOwners, active);
}

/**
 * Declare something that owns the screen WITHOUT presenting a Modal — an
 * inline sheet, and nothing else so far. Nothing can collide with it, so it
 * stays out of the modal count.
 */
export function useRegisterScreenOwner(active: boolean): void {
  useHold(screenOwners, active);
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
  onCloseRequest,
  dimmed = true,
  avoidKeyboard = false,
  inline = false,
  scrolls = false,
  footer,
}: {
  children: ReactNode;
  onClose: () => void;
  /**
   * Where a dismissal GESTURE lands — the scrim tap, the pull-down, the
   * grabber's accessibility tap, Android's back — when the caller wants a
   * say before state is thrown away (a discard guard raising an Alert, which
   * is safe while the sheet is still presented). When absent, every path
   * calls onClose and nothing changes for the other callers. The refused
   * pull needs no help: the drag offset springs home on every gesture end
   * regardless, so a guarded sheet is never left parked halfway off screen.
   */
  onCloseRequest?: () => void;
  dimmed?: boolean;
  /** Lift the sheet above the keyboard — for sheets that contain inputs. */
  avoidKeyboard?: boolean;
  /**
   * Give the children a scroller of their own. The sheet caps its height at
   * the screen, but flexShrink defaults to 0, so a sheet whose children do
   * not shrink runs its overflow off the BOTTOM of the screen — and the drag
   * gesture is down-only, so there is no way to pull it back. Opt-in rather
   * than default: pin-form-sheet and place-sheet own their scrollers already
   * and must not gain a second one.
   */
  scrolls?: boolean;
  /**
   * Rendered as a sibling BELOW the scroller, so a primary action is never
   * reachable only by scrolling (the traps rule). Only read when `scrolls`.
   */
  footer?: ReactNode;
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
  // one of its own waits its turn. One or the other, never both: an inline
  // sheet renders no Modal, so nothing can collide with it and it must stay
  // out of the collision count — but it is still what somebody is looking at,
  // and the primer arriving over the confirmation card for the pin you just
  // dropped is a fair question asked at the worst moment.
  useRegisterNativeModal(!inline);
  useRegisterScreenOwner(inline);

  // Every dismissal gesture routes through here, so a guard set by the
  // caller sees the scrim tap and the pull alike. Direct onClose calls from
  // a sheet's own content (a Close button, leavingSheet) are deliberate and
  // stay direct.
  const requestClose = onCloseRequest ?? onClose;

  // Down only: dragging up would let a sheet leave its own bottom edge, and
  // the rubber-band there reads as a bug rather than as resistance.
  //
  // The detector wraps the whole CARD (below), not the 24pt grabber strip it
  // used to. On iOS a grabber means "this thing is draggable", and a card you
  // can only drag by 4pt of visible bar advertises a gesture that a reach for
  // the title does not find. Two consequences follow, and both are handled
  // here rather than at the call sites:
  //
  // `.activeOffsetY(10)` is the whole composition story. It is a DOWNWARD-only
  // threshold — a positive offset sets the end of the dead zone and leaves the
  // start unbounded, so an upward drag can never activate this at all, which
  // is the down-only decision enforced at the gesture rather than only clamped
  // in the handler. The 10pt dead zone is what keeps the pan off a tap: every
  // button on the card is now under the detector, and without a threshold the
  // pan would claim the touch before the Pressable settled.
  //
  // It is also what lets an inner list keep scrolling. A sheet's scroller is a
  // UIScrollView nested INSIDE this view, its own pan recognises well before
  // 10pt of travel, and RNGH's delegate refuses simultaneous recognition with
  // a recogniser it has no declared relation to — so the scroller recognises
  // first and prevents this one. A drag that starts in the venue list scrolls;
  // a drag that starts on the header, where no scroller is under the finger,
  // dismisses.
  //
  // Deliberately NOT `blocksExternalGesture(scroller)`: that reverses the
  // relation and makes the scroller wait for this pan to fail, which is the
  // unscrollable venue list the package's risk note names. And not
  // `simultaneousWithExternalGesture` either, which would scroll the list and
  // drag the sheet down at the same time. The scrollers that matter most here
  // (place-sheet's venue stack, pin-form-sheet's form) live in `children` and
  // have no ref this file could reach anyway, so the threshold is the only
  // composition that covers all of them.
  const pull = Gesture.Pan()
    .activeOffsetY(10)
    .onUpdate((event) => {
      drag.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      // Reset either way. On dismissal the sheet is normally unmounted by
      // the caller, but a caller that keeps it mounted — a refused discard
      // guard does — must not be left with a sheet parked halfway off the
      // screen.
      drag.value = withSpring(0, Springs.release);
      if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(requestClose)();
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
      // Space.md, not lg: over the home indicator's own inset the larger
      // step read as a band of dead sheet under every card's last control
      // (the guest gate wore it worst - a 200pt card in a 40%-tall sheet).
      paddingBottom: Math.max(insets.bottom, lift) + Space.md,
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
            onPress={requestClose}
          />
        </Animated.View>
      ) : null}

      {/* The whole card is the drag target. It used to be the grabber alone,
          which meant a pull on a card's own title did nothing — on three
          surfaces that sit over the live map and are all reached for by the
          header. See the gesture above for why a threshold, and not an
          external-gesture relation, is what keeps an inner list scrolling. */}
      <GestureDetector gesture={pull}>
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
          {/* Still a 24pt strip around 4pt of visible bar, and still the
              VoiceOver path: "Dismiss" performed on the grabber is the only
              way to close a sheet without a pointer, and a pull is not
              something VoiceOver can perform. It is no longer the only place
              the drag is accepted, but it is still where the drag is
              ADVERTISED, so it keeps its hint. */}
          <View
            accessible
            testID="sheet-grabber"
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            accessibilityHint="Or pull down"
            onAccessibilityTap={requestClose}
            style={styles.grabberTarget}>
            <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />
          </View>
          {scrolls ? (
            <>
              {/* Same recipe as pin-form-sheet's scroller: shrinks rather than
                  overflows, "always" so a tap on the next field is not eaten
                  while one has focus, and dragging dismisses the keyboard. */}
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="always"
                keyboardDismissMode="interactive">
                {children}
              </ScrollView>
              {footer}
            </>
          ) : (
            children
          )}
        </Animated.View>
      </GestureDetector>
      {/* A sheet presented through a Modal is hosted in its OWN window, so
          the bar the screen underneath mounted cannot be reached from a field
          in here. Every sheet with a field needs one of its own. */}
      <KeyboardDoneBar />
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
    <Modal
      transparent
      visible
      statusBarTranslucent
      animationType="none"
      onRequestClose={requestClose}>
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
  scroll: {
    // Shrinks rather than overflows: the sheet is capped to the screen and
    // grows a keyboard-sized floor, so this is what gives way.
    flexShrink: 1,
  },
  scrollContent: {
    // The gap the sheet's own column would have put between these children.
    gap: Space.md,
  },
});
