import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/ui/pressable-scale';
import {
  SHEET_SETTLE_MS,
  presentedModalCount,
  useRegisterNativeModal,
} from '@/components/ui/sheet';
import { Motion, Radius, Space, Springs } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A photo, ready to be looked at.
 *
 * THE URL IS THE CALLER'S, and that is the one design decision in this file
 * worth arguing about. The spec said to sign it here with `usePhotoUrl`, and
 * that is wrong about the code: `usePhotoUrl` signs against the
 * `profile-photos` bucket (features/profile/api.ts) and a chat photo lives in
 * `chat-photos` behind `signedChatPhotoUrl` (features/chat/api.ts:126). A
 * viewer that signed for itself would work on two of its three callers and
 * quietly show nothing on the third.
 *
 * So the viewer signs nothing. It takes a URL somebody else already signed,
 * which keeps every photo in the app behind the short-lived signed URL its
 * own private bucket issues - there is no public link anywhere in here, and
 * no place to introduce one.
 */
export type ViewablePhoto = {
  /** A signed URL from whichever private bucket owns this photo. */
  uri: string | null;
  /** What the photo IS, spoken. "Mara, photo 3 of 5". */
  label: string;
};

/** How far it has to travel before letting go closes the viewer. */
const DISMISS_DISTANCE = 110;
/** Or how fast, for a flick that never gets that far. */
const DISMISS_VELOCITY = 900;
/** Pinching past this is resisted; a photo is not a map. */
const MAX_ZOOM = 4;
/** What a double tap zooms to, and back from. */
const TAP_ZOOM = 2.5;

/**
 * One full-screen photo, on the app's own ground, with nothing on it.
 *
 * The point of a photo in this app is "look at this" - a rooftop, a meeting
 * spot, a face you are about to write to - and every photo in the app was a
 * fixed square showing the middle of the frame. This is where a photo gets
 * looked at properly: pinch to zoom, drag to move it around, pull down to put
 * it away.
 *
 * Mount it once per screen with `photo={null}` and set the photo to open it.
 * Everything below the gate mounts only while a photo is actually being
 * looked at, so a screen that merely has a viewer carries no gesture tree and
 * asks for no window size it is not using. Its claim on the screen runs from
 * the tap until a settle window after the photo is put away, and there is no
 * other moment at which this component costs anything.
 */
export function PhotoViewer({
  photo,
  onClose,
}: {
  photo: ViewablePhoto | null;
  onClose: () => void;
}) {
  // Claim the screen from the moment a photo is chosen until a settle window
  // after it is put away. The trailing half is the part that is easy to miss:
  // unmounting the Modal starts a fade-out, and until that has finished iOS
  // is still dismissing — so a claim that ended on the unmount would tell the
  // next presenter the screen was free while the photo was still on it. Held
  // here rather than inside Stage for exactly that reason: Stage is gone by
  // then.
  const { onScreen, settling } = useHeldThroughExit(photo != null);
  useRegisterNativeModal(onScreen);

  if (!photo) {
    return null;
  }
  return (
    <SettleGate settling={settling}>
      {/* animationType, not an entrance of our own: a Reanimated Slide preset
          animates the view's real layout and re-applies the frame it
          snapshotted for the whole run, which is the bug that opened the place
          card a third of the way (traps). The system fade owns the
          presentation; the gestures inside own everything after it. */}
      <Modal
        transparent
        visible
        statusBarTranslucent
        animationType="fade"
        // app.json locks the app to portrait and there is no per-screen
        // override without a native dependency and a build, so this states
        // what is already true rather than asking for something new. Landscape
        // for the viewer is a separate, more expensive question.
        supportedOrientations={['portrait']}
        onRequestClose={onClose}>
        <Stage photo={photo} onClose={onClose} />
      </Modal>
    </SettleGate>
  );
}

/**
 * Hold THIS presentation until the screen has had time to clear.
 *
 * iOS silently drops a modal presentation that starts while another modal is
 * dismissing, and on Fabric that does not lose the modal: it leaves an
 * invisible full-screen ModalHostView in the tree whose hit test answers every
 * point on screen, and the app is dead to touch until relaunch (the traps
 * skill). The likeliest caller of this viewer is a photo inside a sheet, so
 * the collision is not hypothetical.
 *
 * Three rules. The first two are about what was in the way; the third is
 * about not charging for the same wait twice. The question is asked ONCE, at
 * the moment the photo is chosen: if nothing was presented then, the viewer
 * opens in the same frame and the settle delay is never spent. And if
 * something WAS, the timer is armed unconditionally — the gate never waits on
 * the count coming down, because an interaction must never depend on an event
 * that might not arrive (traps).
 *
 * It used to wait on exactly that: `if (open || sheets > 0) return` schedules
 * nothing at all while the count is non-zero. The map's pin card is an inline
 * sheet that nothing clears on blur, so the count sat at 1 for the rest of the
 * session, and a photo tapped on any screen afterwards did nothing — no
 * feedback, no way to tell it from a press that never registered — and then
 * presented itself full screen over whatever was there when the card was
 * finally dismissed. Scoping the count to real modals fixed the map's half of
 * that; this is the half that says a gate must be about the presentation it
 * is gating.
 *
 * THE THIRD RULE: a wait already half served is not paid for twice. The
 * viewer's own claim outlives its Modal by a settle window (below), so a
 * second photo opened during a gallery browse — which is most of what this
 * thing is for — found that claim in the count and was charged a whole fresh
 * SHEET_SETTLE_MS on top of however much of the first one had already run.
 * The claim is not spurious: the previous Modal really is still fading, and
 * presenting into that is the drop this file exists to avoid. What was wrong
 * is the arithmetic. So this viewer's own exit is not counted as an obstacle
 * here — it is waited out on the timer that is already running for it, which
 * ends when the fade does. Anything ELSE in the count still costs a full
 * window, because nothing here knows when somebody else's dismissal began.
 */
function SettleGate({ settling, children }: { settling: boolean; children: ReactNode }) {
  // Read once rather than watched. What matters is whether this tap had
  // something in its way, not what the app-wide count does afterwards. This
  // viewer's own exit is subtracted: it is in the count, and it is real, but
  // it is the one dismissal whose end is already on a clock of ours.
  const [blocked] = useState(() => presentedModalCount() - (settling ? 1 : 0) > 0);
  const [waited, setWaited] = useState(!blocked);

  useEffect(() => {
    if (waited) {
      return;
    }
    // Armed unconditionally, never on the count coming down.
    const timer = setTimeout(() => setWaited(true), SHEET_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [waited]);

  return waited && !settling ? <>{children}</> : null;
}

/**
 * True while `active`, and for one settle window after it stops — and whether
 * that trailing window is what is running right now, which is the half
 * SettleGate needs.
 *
 * "Unmounted in React" is not "gone from the screen": the Modal fades out
 * over a few hundred milliseconds after the tree holding it goes, and a
 * presentation beginning inside that window is the one iOS drops. So the
 * claim on the screen outlives the thing that made it.
 *
 * `settling` deliberately KEEPS RUNNING when a photo is opened again inside
 * the window. It is not the state of this component, it is the state of the
 * screen: the last Modal is still fading whatever React does next, and its
 * clock started when it was closed. That clock is what the gate above waits
 * on, so a second photo pays the rest of the first one's window and not a new
 * one.
 */
function useHeldThroughExit(active: boolean): { onScreen: boolean; settling: boolean } {
  // Stored during render rather than set from an effect: the sanctioned way
  // to react to a prop change without a second commit, and the same pattern
  // the push primer uses to re-arm itself.
  const [was, setWas] = useState(active);
  const [settling, setSettling] = useState(false);
  // Bumped on every exit. The timer below re-arms on it, so a photo closed,
  // reopened and closed again gets a fresh window for the second fade instead
  // of inheriting the first one's deadline.
  const [exits, setExits] = useState(0);
  if (was !== active) {
    setWas(active);
    if (!active) {
      setSettling(true);
      setExits((count) => count + 1);
    }
  }

  useEffect(() => {
    if (!settling) {
      return;
    }
    const timer = setTimeout(() => setSettling(false), SHEET_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling, exits]);

  return { onScreen: active || settling, settling };
}

/**
 * Everything inside the Modal, in its own component on purpose.
 *
 * It mounts only while the viewer is actually up, so a screen that merely HAS
 * a viewer never builds a gesture tree and never asks for a window size it is
 * not using. The native-modal registration is NOT here: it has to outlive
 * this component by the length of the fade-out, so PhotoViewer holds it.
 */
function Stage({ photo, onClose }: { photo: ViewablePhoto; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const scale = useSharedValue(1);
  const settled = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const restX = useSharedValue(0);
  const restY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(MAX_ZOOM, Math.max(1, settled.value * event.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        // All the way back, not almost: a photo left at 1.01 keeps the pan
        // gesture in its zoomed branch, and the pull-down stops closing.
        scale.value = withSpring(1, Springs.release);
        settled.value = 1;
        x.value = withSpring(0, Springs.release);
        y.value = withSpring(0, Springs.release);
        restX.value = 0;
        restY.value = 0;
        return;
      }
      settled.value = scale.value;
    });

  const drag = Gesture.Pan()
    .onUpdate((event) => {
      if (settled.value > 1) {
        x.value = restX.value + event.translationX;
        y.value = restY.value + event.translationY;
        return;
      }
      // Not zoomed: the drag is the dismissal, and sideways travel is damped
      // so it reads as resistance rather than as a photo coming loose.
      x.value = event.translationX * 0.3;
      y.value = event.translationY;
    })
    .onEnd((event) => {
      if (settled.value > 1) {
        restX.value = x.value;
        restY.value = y.value;
        return;
      }
      if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(onClose)();
        return;
      }
      x.value = withSpring(0, Springs.release);
      y.value = withSpring(0, Springs.release);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = settled.value > 1 ? 1 : TAP_ZOOM;
      settled.value = next;
      scale.value = withSpring(next, Springs.release);
      if (next === 1) {
        x.value = withSpring(0, Springs.release);
        y.value = withSpring(0, Springs.release);
        restX.value = 0;
        restY.value = 0;
      }
    });

  // Pinch and drag run together (two fingers moving apart are also two
  // fingers moving); the double tap has to win outright or the first of its
  // two taps arms a drag.
  const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, drag));

  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  // The ground thins out as the photo is pulled away, so the gesture says
  // what it is doing before the finger comes off. Nothing here carries an
  // `entering` as well - two things driving one opacity is non-deterministic
  // and the loser is invisible (traps).
  const groundStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.65, Math.abs(y.value) / Math.max(1, height)),
  }));

  return (
    // A Modal is hosted in its own native window, outside the gesture root
    // the navigator establishes - without this every gesture in here is dead.
    <GestureHandlerRootView
      // VoiceOver stops here rather than reading the screen behind the
      // viewer. On the root, not on the ground below it: the flag hides
      // everything OUTSIDE the view that carries it, so on the scrim it hid
      // the photo and the close button too.
      accessibilityViewIsModal
      style={styles.root}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.canvas }, groundStyle]}
      />
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.stage, photoStyle]}>
          {photo.uri ? (
            <Image
              source={{ uri: photo.uri }}
              style={{ width, height }}
              // contain, not cover: the whole reason to open a photo is to
              // see the two thirds the square crop was hiding.
              contentFit="contain"
              transition={Motion.quick}
              accessibilityLabel={photo.label}
            />
          ) : (
            // Still signing. A black screen with nothing on it is
            // indistinguishable from a photo that failed to arrive.
            <ActivityIndicator />
          )}
        </Animated.View>
      </GestureDetector>
      {/* The only chrome, and it earns its place: pull-down is not
          discoverable and VoiceOver cannot perform it, so without a control
          here the viewer is a room with no door for anybody driving the app
          by voice or by switch. "Close photo" rather than "Close" because a
          sheet underneath may carry a Close of its own, and two identical
          labels are ambiguous. */}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Close photo"
        testID="photo-viewer-close"
        haptic="light"
        scaleTo={0.9}
        hitSlop={6}
        onPress={onClose}
        containerStyle={[styles.closeAnchor, { top: insets.top + Space.sm }]}
        style={[styles.close, { backgroundColor: theme.surface }]}>
        <SymbolView
          name={{ ios: 'xmark', android: 'close', web: 'close' }}
          size={15}
          tintColor={theme.text}
        />
      </PressableScale>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  stage: {
    // Written out rather than spread from StyleSheet.absoluteFill: that
    // constant is a registered style, and absoluteFillObject is not in this
    // RN's typings at all (traps).
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeAnchor: {
    position: 'absolute',
    // start, not left: in a right-to-left locale the door belongs on the
    // side the reader's thumb starts from.
    start: Space.lg,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
