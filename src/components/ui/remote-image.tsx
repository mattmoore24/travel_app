import {
  Image,
  type ImageContentFit,
  type ImageContentPosition,
  type ImageErrorEventData,
  type ImageLoadEventData,
  type ImageSource,
} from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Skeleton } from '@/components/ui/skeleton';
import { Motion } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Phase = 'loading' | 'loaded' | 'failed';

/** The glyph a frame shows for a photo that did not arrive. */
const FAILED_GLYPH = { ios: 'photo', android: 'image', web: 'image' } as const;

/** Under this on its short side a frame is an avatar, too small to be a retry target. */
const RETRY_MIN_SIDE = 96;

export type RemoteImageProps = {
  /**
   * Passed to expo-image UNCHANGED, so the cache key `photoSource` put on it
   * survives and a test can still read `props.source.uri` off the Image.
   * Null while there is nothing to show yet: see `pending` for which null.
   */
  source: ImageSource | null;
  /**
   * The signed URL is still being fetched. Null + pending is a photo that
   * exists and has not been signed; null + not pending is no photo at all,
   * which is the only time `fallback` is true.
   */
  pending?: boolean;
  /** The frame. Width, height or aspectRatio, and any radius, go here. */
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  contentPosition?: ImageContentPosition;
  accessibilityLabel?: string;
  /** Fade-in on arrival, in ms. Zero under Reduce Motion whatever is passed. */
  transition?: number;
  /** expo-image's recycling key, for a frame reused across list rows. */
  recyclingKey?: string;
  /**
   * What is drawn while bytes are on their way. `pulse` is the Skeleton;
   * `flat` is the bare sunken ground, for a frame small enough that a pulse
   * reads as a flicker (an avatar in a row); `none` draws nothing at all.
   */
  skeleton?: 'pulse' | 'flat' | 'none';
  /** What stands in for the photo when there is none: a glyph, a monogram. */
  fallback?: ReactNode;
  onLoad?: (event: ImageLoadEventData) => void;
  onError?: (event: ImageErrorEventData) => void;
  testID?: string;
};

/**
 * The one place a remote photo's four states are drawn.
 *
 * A photo here is signed, then downloaded, then shown, or it fails, and
 * every frame in the app used to answer those four with whatever its screen
 * had to hand: a Skeleton, nothing, a grey box that stayed grey forever, an
 * Image with no source that drew a transparent rectangle over a bare View.
 * On hostel wifi the difference between "still coming" and "not coming" is
 * the whole screen, and a frame that cannot say which is a frame that
 * looks broken either way.
 *
 * WHY THE SKELETON SITS UNDER THE IMAGE. expo-image draws nothing until the
 * bytes land, and its `transition` fades the picture in from transparent.
 * A Skeleton beneath the Image is therefore visible for exactly as long as
 * the frame is empty and is faded OVER by the photo when it arrives, which
 * is the one ordering that needs no second animation and never flashes the
 * ground between the two. The Image's own `placeholder` was not used because
 * it takes a source, not a component, and the pulse is a component.
 *
 * The frame's ground is `surfaceSunken` in every state, so a failed photo,
 * a signing photo and a photo halfway through its fade all sit on the same
 * colour, and the swap between them moves nothing.
 */
export function RemoteImage({
  source,
  pending = false,
  style,
  contentFit = 'cover',
  contentPosition,
  accessibilityLabel,
  transition = Motion.quick,
  recyclingKey,
  skeleton = 'pulse',
  fallback,
  onLoad,
  onError,
  testID,
}: RemoteImageProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('loading');
  // Bumped by a retry and used as the Image's key, so a press on the failed
  // glyph remounts the Image and expo-image asks for the bytes again.
  const [attempt, setAttempt] = useState(0);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);

  // A new photo starts over. Reset during render when the identity changes,
  // the sanctioned "storing information from previous renders" pattern the
  // map's useMarkerTracking uses; setting it from an effect would be a
  // second commit on every source change, and the thing
  // react-hooks/set-state-in-effect exists to catch. The identity is the
  // URI and the recycling key together: a recycled row can be handed the
  // same URI it had before and must still show a fresh load, and a re-sign
  // of the same object is a new URI over the same bytes, which is a
  // load either way as far as this frame can tell.
  const identity = `${source?.uri ?? ''}\n${recyclingKey ?? ''}`;
  const [prevIdentity, setPrevIdentity] = useState(identity);
  if (prevIdentity !== identity) {
    setPrevIdentity(identity);
    if (phase !== 'loading') {
      setPhase('loading');
    }
  }

  const shortSide = frame == null ? null : Math.min(frame.width, frame.height);
  const failed = source != null && phase === 'failed';
  const loading = source == null ? pending : phase === 'loading';
  const noPhoto = source == null && !pending;
  // Sized to the frame, never over it: an avatar gets a glyph that fits
  // inside the circle, a hero gets the full 24. Before the first layout the
  // frame is unknown and 24 is the guess that is right for most of them.
  const glyphSize = shortSide == null ? 24 : Math.min(24, Math.round(shortSide * 0.4));
  const retryable = shortSide != null && shortSide >= RETRY_MIN_SIDE;
  const name = accessibilityLabel ?? 'Photo';

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame((prev) =>
      prev != null && prev.width === width && prev.height === height ? prev : { width, height }
    );
  };

  const retry = () => {
    setAttempt((count) => count + 1);
    setPhase('loading');
  };

  return (
    <View
      testID={testID}
      onLayout={onLayout}
      style={[styles.frame, { backgroundColor: theme.surfaceSunken }, style]}>
      {loading && skeleton === 'pulse' ? (
        <Skeleton style={StyleSheet.absoluteFill} radius={0} />
      ) : null}
      {noPhoto && fallback != null ? <View style={styles.centred}>{fallback}</View> : null}
      {source != null ? (
        <Image
          key={attempt}
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          contentPosition={contentPosition}
          cachePolicy="memory-disk"
          transition={reduceMotion ? 0 : transition}
          recyclingKey={recyclingKey}
          accessibilityLabel={accessibilityLabel}
          // The failed overlay speaks for the frame once the photo is gone;
          // an empty Image announcing "Photo" beneath it would be a lie.
          accessible={accessibilityLabel != null && !failed}
          onLoad={(event) => {
            setPhase('loaded');
            onLoad?.(event);
          }}
          onError={(event) => {
            setPhase('failed');
            onError?.(event);
          }}
        />
      ) : null}
      {failed ? (
        retryable ? (
          // Big enough to be a target: the whole frame is the button, so a
          // person taps the picture that did not come, which is what they
          // would try anyway. Label says what it is; the hint says what a
          // press does.
          <Pressable
            style={styles.centred}
            accessibilityRole="button"
            accessibilityLabel={`${name} could not load`}
            accessibilityHint="Try the photo again"
            onPress={retry}>
            <SymbolView name={FAILED_GLYPH} size={glyphSize} tintColor={theme.textTertiary} />
          </Pressable>
        ) : (
          // Too small to be worth a target of its own: the row it sits in is
          // the thing to tap. No words either; at avatar size there is no
          // room for them and the glyph is the whole message.
          <View
            style={styles.centred}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${name} could not load`}>
            <SymbolView name={FAILED_GLYPH} size={glyphSize} tintColor={theme.textTertiary} />
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
  },
  centred: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
