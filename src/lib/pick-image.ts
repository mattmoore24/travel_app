import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';

type PickImageOptions = {
  /**
   * Hand the photo to the system editor before it comes back. On iOS the
   * editor is always square whatever `aspect` says; forwarded to the camera
   * and the library alike so both paths return the same shape.
   */
  allowsEditing?: boolean;
  /**
   * Called when the library permission is refused AND iOS will not ask
   * again — the case that used to leave the mandatory photo step a silent
   * dead end. The caller owns the recovery UI (a Settings link); this module
   * only reports the fact and resolves null.
   */
  onLibraryBlocked?: () => void;
};

/**
 * Ask for one photo: camera on a device, library everywhere. Resolves to a
 * local URI, or null when the person backed out — which is not an error and
 * should never produce an alert.
 *
 * Shared so every "add a photo" in the app asks the same question the same
 * way. Anything that then uploads goes through the moderation pipeline in
 * lib/image-upload. Defaults leave option-less callers exactly as they were.
 */
export function pickImage({ allowsEditing, onLibraryBlocked }: PickImageOptions = {}): Promise<
  string | null
> {
  const fromLibrary = async (): Promise<string | null> => {
    // Asking first is what makes a refusal visible: the editing picker with
    // permission denied simply returns canceled, indistinguishable from
    // backing out, and the plus tile then does nothing forever. ONLY on the
    // editing path: without allowsEditing the library launch is
    // PHPickerViewController, which needs no photo-library permission at all
    // (ImagePickerModule.swift routes there unguarded), so asking would put
    // a brand-new permission wall in front of the chat and group pickers
    // that never had one.
    if (allowsEditing) {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted && !permission.canAskAgain) {
        onLibraryBlocked?.();
        return null;
      }
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing,
      quality: 1,
    });
    return !picked.canceled && picked.assets.length > 0 ? picked.assets[0].uri : null;
  };

  if (Platform.OS === 'web') {
    return fromLibrary();
  }

  return new Promise((resolve) => {
    Alert.alert('Add a photo', undefined, [
      {
        text: 'Take a photo',
        onPress: async () => {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            resolve(await fromLibrary());
            return;
          }
          const shot = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing,
            quality: 1,
          });
          resolve(!shot.canceled && shot.assets.length > 0 ? shot.assets[0].uri : null);
        },
      },
      { text: 'Choose from library', onPress: async () => resolve(await fromLibrary()) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}
