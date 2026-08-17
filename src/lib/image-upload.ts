import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { supabase } from '@/lib/supabase';

const MAX_DIMENSION = 1440;

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
  context.resize({ width: MAX_DIMENSION });
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
