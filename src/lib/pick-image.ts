import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';

/**
 * Ask for one photo: camera on a device, library everywhere. Resolves to a
 * local URI, or null when the person backed out — which is not an error and
 * should never produce an alert.
 *
 * Shared so every "add a photo" in the app asks the same question the same
 * way. Anything that then uploads goes through the moderation pipeline in
 * lib/image-upload.
 */
export function pickImage(): Promise<string | null> {
  const fromLibrary = async (): Promise<string | null> => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
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
