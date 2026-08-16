import 'react-native-get-random-values';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';

/**
 * Supabase session storage for native. SecureStore (iOS keychain) caps values
 * at ~2KB — smaller than a Supabase session — so we follow Supabase's
 * documented pattern: a random AES-256 key lives in the keychain, and the
 * session ciphertext lives in AsyncStorage. Compromising the session requires
 * both stores.
 */
export class SecureSessionStore {
  private keyId(key: string) {
    // SecureStore keys must be alphanumeric plus ". - _".
    return `sk_${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  }

  async getItem(key: string): Promise<string | null> {
    const [hexKey, ciphertextHex] = await Promise.all([
      SecureStore.getItemAsync(this.keyId(key)),
      AsyncStorage.getItem(key),
    ]);
    if (!hexKey || !ciphertextHex) {
      return null;
    }
    try {
      const cipher = new aesjs.ModeOfOperation.ctr(
        aesjs.utils.hex.toBytes(hexKey),
        new aesjs.Counter(1)
      );
      const decrypted = cipher.decrypt(aesjs.utils.hex.toBytes(ciphertextHex));
      return aesjs.utils.utf8.fromBytes(decrypted);
    } catch {
      // Corrupt/mismatched material: treat as signed out rather than crashing.
      await this.removeItem(key);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const ciphertext = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(this.keyId(key), aesjs.utils.hex.fromBytes(encryptionKey));
    await AsyncStorage.setItem(key, aesjs.utils.hex.fromBytes(ciphertext));
  }

  async removeItem(key: string): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(this.keyId(key)),
      AsyncStorage.removeItem(key),
    ]);
  }
}
