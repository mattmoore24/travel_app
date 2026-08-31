import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/**
 * The only sanctioned way to capture a VERIFICATION photo.
 *
 * Every verification in this app, for a person and for a place, has to be a
 * photograph taken at the moment of verifying. That is the entire mechanism:
 * a selfie proves a face is live right now, and two storefront shots prove
 * somebody is standing outside the premises right now. A photo library turns
 * both of those into a search and a download, which is not a weaker check but
 * a different one that proves nothing at all.
 *
 * So this module never imports `launchImageLibraryAsync`, and the screens that
 * verify never call it. A source-scanning test enforces both, because the
 * failure is invisible: a library fallback looks like a kindness to somebody
 * who denied a permission, and the selfie screen shipped with exactly that
 * kindness in it for months.
 *
 * Ordinary photos are a different question. Profile photos and a business's
 * gallery come from wherever people keep their photos, as they should, and
 * PhotoGrid is right to offer the library.
 */

export type LiveCaptureResult =
  | { kind: 'captured'; uri: string }
  /** They backed out of the camera. Not an error, and nothing to say. */
  | { kind: 'cancelled' }
  /** Camera permission refused. The caller has to explain, not work around. */
  | { kind: 'denied' }
  /** No camera to reach, which on this app means the web build. */
  | { kind: 'unavailable' };

export async function captureLivePhoto(options?: {
  /** Front camera for a selfie; leave unset for anything else. */
  front?: boolean;
  /**
   * Offer the system crop tool.
   *
   * Off by default, and the storefront check leaves it off deliberately: a
   * crop is a way to cut the street out of a wide shot, and the street is the
   * half that cannot be downloaded from anywhere.
   */
  allowsEditing?: boolean;
  /** Android-only: iOS's system editor is always square and ignores this. */
  aspect?: [number, number];
}): Promise<LiveCaptureResult> {
  if (Platform.OS === 'web') {
    // expo-image-picker's camera is not dependable in a browser, and the one
    // thing we must not do here is quietly reach for the library instead.
    return { kind: 'unavailable' };
  }

  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { kind: 'denied' };
  }

  const shot = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
    ...(options?.front ? { cameraType: ImagePicker.CameraType.front } : null),
    ...(options?.allowsEditing ? { allowsEditing: true } : null),
    ...(options?.aspect ? { aspect: options.aspect } : null),
  });

  if (shot.canceled || shot.assets.length === 0) {
    return { kind: 'cancelled' };
  }
  return { kind: 'captured', uri: shot.assets[0].uri };
}

/** What to tell somebody whose camera we cannot reach. One sentence each. */
export function captureBlockedMessage(result: LiveCaptureResult): string | null {
  if (result.kind === 'denied') {
    return 'We need the camera for this one, and it has to be a photo you take now rather than one from your library. Turn it on in Settings and come back.';
  }
  if (result.kind === 'unavailable') {
    return 'This one needs a camera, so it has to be done on your phone.';
  }
  return null;
}
