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
    // Bounded: Image.getSize is a native callback with no failure timeout of
    // its own, and a callback that never fires must degrade to "resize
    // anyway", never hold the upload.
    const timer = setTimeout(() => resolve(null), 3000);
    Image.getSize(
      uri,
      (width) => {
        clearTimeout(timer);
        resolve(width);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/**
 * A stage that cannot hang. e2e runs 90 and 91 sat on the upload tile's
 * spinner for over a minute, five accounts in a row, with nothing on screen
 * and nothing in a log to say WHICH await had stalled - an unsettled promise
 * is invisible by construction. Naming the stage in the error puts the
 * diagnosis in the alert (and in the failure screenshot), and a bounded wait
 * is the right behaviour on hostel wifi regardless: an error with a retry
 * beats an infinite spinner.
 */
function within<T>(ms: number, stage: string, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`The photo did not go through. It got stuck while ${stage}, so try again.`)
        ),
      ms
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
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
  // 90s, up from 45s, up from the 20s these started at. Run 93 photographed a
  // WORKING render being killed at 20s; run 97 lost the business tour twice to
  // the same alert at 45s, on a bound the comment beside it already described
  // as covering "16-60s on a cold CI simulator" — a budget set inside the
  // range of times it is meant to allow will fail there sooner or later, and
  // it did. The bound exists to end HANGS, not to race slow hardware, and 90s
  // still turns an infinite spinner into an error with a retry, which is its
  // whole job. The flow that waits on it allows 150s, so this stays inside it.
  //
  // The two stages are named apart on purpose. They shared the word
  // "preparing it", so an alert in a failure screenshot could not say whether
  // the RENDER or the JPEG ENCODE had stalled, and the next person debugging
  // this had a screenshot that ruled nothing out. One word each is cheap, and
  // both are honest sentences to read on a phone.
  const rendered = await within(90_000, 'preparing it', context.renderAsync());
  const result = await within(
    90_000,
    'compressing it',
    rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG })
  );

  const storagePath = `${userId}/${randomId()}.jpg`;
  const body = await within(
    15_000,
    'reading it',
    fetch(result.uri).then((response) => response.arrayBuffer())
  );

  const { error } = await within(
    45_000,
    'sending it',
    supabase.storage.from(bucket).upload(storagePath, body, { contentType: 'image/jpeg' })
  );
  if (error) {
    throw error;
  }
  return storagePath;
}

/** The stage racer, exported for its jest alone. */
export const withinForTests = within;

/** Best-effort cleanup when the row/RPC step after an upload fails. */
export async function removeUploadedImage(bucket: string, storagePath: string) {
  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) {
    console.warn(`orphaned storage object ${storagePath}: ${error.message}`);
  }
}
