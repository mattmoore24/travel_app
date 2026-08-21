import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

import { supabase } from '@/lib/supabase';

const MAX_DIMENSION = 1440;

/**
 * How wide the picked file actually is, or null when it cannot be read. Used
 * only to decide whether resizing is worth doing — a failure here falls back
 * to resizing, which is what this did unconditionally before.
 */
function sourceWidth(uri: string): Promise<number | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width) => resolve(width),
      () => resolve(null)
    );
  });
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Downscale + JPEG-compress a picked image and upload it under the owner's
 * storage folder (`<user_id>/<random>.jpg` — every bucket's write policy keys
 * off that first path segment). Returns the storage path.
 *
 * Shared by profile photos, verification selfies and chat photos so a fix to
 * the image pipeline lands in one place.
 */
export async function processAndUploadImage(bucket: string, userId: string, localUri: string) {
  const context = ImageManipulator.manipulate(localUri);
  // Only shrink. Resizing unconditionally enlarged a photo somebody had saved
  // from a chat app to 1440px of interpolated pixels and then re-encoded it,
  // turning a 60KB file into a few hundred KB that looked softer than the
  // original — paid for on whatever wifi they are actually on.
  const width = await sourceWidth(localUri);
  if (width == null || width > MAX_DIMENSION) {
    context.resize({ width: MAX_DIMENSION });
  }
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });

  const storagePath = `${userId}/${randomId()}.jpg`;
  const response = await fetch(result.uri);
  const body = await response.arrayBuffer();

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, body, { contentType: 'image/jpeg' });
  if (error) {
    throw error;
  }
  return storagePath;
}

/** Best-effort cleanup when the row/RPC step after an upload fails. */
export async function removeUploadedImage(bucket: string, storagePath: string) {
  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) {
    console.warn(`orphaned storage object ${storagePath}: ${error.message}`);
  }
}
