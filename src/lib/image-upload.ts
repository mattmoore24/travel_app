import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

import { supabase } from '@/lib/supabase';

const MAX_DIMENSION = 1440;

/**
 * The short edge a photo needs before it is allowed to be a HERO — a profile
 * photo or a business listing photo, both of which render full-bleed at
 * roughly 1170 device pixels on the phones this ships to.
 *
 * 512 rather than 640, and the difference is a real photo either way. A
 * legitimately cropped shot off an older phone lands between the two, and
 * refusing a real photograph is worse than accepting a soft one: the person
 * with the older phone has no second file to reach for, while the person who
 * saved a 320px picture out of a chat app does.
 *
 * The short edge, not the width, because a 400x1200 crop is exactly the file
 * this is for: wide enough to pass a width test, and stretched to nearly four
 * times its own resolution the moment it fills a frame.
 */
export const HERO_MIN_SHORT_EDGE = 512;

/**
 * "That photo is too small to be a hero." A class rather than a bare Error so
 * a picker can offer the library again in the same breath instead of falling
 * into the generic upload-failed path, which on the photo grid is a tile that
 * says "Not sent" and offers a retry — the one thing that cannot help here,
 * because the same file will be refused again.
 *
 * The message is the sentence a person reads. `saveFailureMessage` shows a
 * written sentence verbatim (lib/failure-message), so a caller that does
 * nothing special still says something true rather than "Something went
 * wrong".
 */
export class PhotoTooSmallError extends Error {
  /** The measured short edge, for the caller that wants to say the number. */
  readonly shortEdge: number;

  constructor(shortEdge: number) {
    super(
      'That one is a bit small to fill the frame. Something straight off your camera will look sharper.'
    );
    this.name = 'PhotoTooSmallError';
    this.shortEdge = shortEdge;
  }
}

/**
 * `instanceof` gets this wrong across module realms (jest module registries,
 * and any future bundle split), and a photo picker silently losing its
 * specific branch is exactly the kind of failure nobody notices. Check the
 * name too.
 */
export function isPhotoTooSmall(error: unknown): error is PhotoTooSmallError {
  return (
    error instanceof PhotoTooSmallError ||
    (error as { name?: unknown } | null)?.name === 'PhotoTooSmallError'
  );
}

/**
 * How big the picked file actually is, or null when it cannot be read.
 *
 * Both edges. This used to return the width alone and throw the height away,
 * which is why a 320px picture saved out of a chat app went through untouched
 * and was blown up into a hero: the only question asked of the file was "is
 * it bigger than 1440", and the answer for a small file is the same as the
 * answer for a perfect one — no resize.
 *
 * A failure here falls back to null, and null means "carry on": resize, and
 * do not refuse. An unreadable size must never block an upload, because the
 * one thing worse than a soft photo is a person who cannot post any photo.
 */
function sourceSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    // Bounded: Image.getSize is a native callback with no failure timeout of
    // its own, and a callback that never fires must degrade to "resize
    // anyway", never hold the upload.
    const timer = setTimeout(() => resolve(null), 3000);
    Image.getSize(
      uri,
      (width, height) => {
        clearTimeout(timer);
        resolve({ width, height });
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

type UploadOptions = {
  /**
   * This photo is going to fill a frame — a profile photo, a business listing
   * photo — so a file too small to do that is refused with
   * `PhotoTooSmallError` rather than stretched.
   *
   * OFF by default, and deliberately. The same pipeline carries chat photos
   * and group photos, and a chat photo is not a hero: a screenshot of a
   * ticket, a map, a menu is legitimately small, renders at bubble width, and
   * refusing it would put an honest-sounding sentence about frames in front
   * of somebody whose picture would have been perfectly readable. No
   * messaging app anybody has used refuses that file, and the design brief is
   * explicit that a messaging screen is the one place novelty is a pure cost.
   */
  fillsAFrame?: boolean;
};

/**
 * Downscale + JPEG-compress a picked image and upload it under the owner's
 * storage folder (`<user_id>/<random>.jpg` — every bucket's write policy keys
 * off that first path segment). Returns the storage path.
 *
 * Shared by profile photos, verification selfies and chat photos so a fix to
 * the image pipeline lands in one place.
 *
 * The random id is minted per upload and never reused, which is what makes
 * the returned path safe to use as an image cache key (lib/photo-source).
 * Anything that ever writes a second set of bytes to an existing path breaks
 * that silently, so do not add one.
 */
export async function processAndUploadImage(
  bucket: string,
  userId: string,
  localUri: string,
  { fillsAFrame = false }: UploadOptions = {}
) {
  // Read the file BEFORE building the manipulation context, so the size check
  // can refuse without having set anything up.
  const size = await sourceSize(localUri);
  if (fillsAFrame && size != null) {
    const shortEdge = Math.min(size.width, size.height);
    if (shortEdge < HERO_MIN_SHORT_EDGE) {
      throw new PhotoTooSmallError(shortEdge);
    }
  }

  const context = ImageManipulator.manipulate(localUri);
  // Only shrink. Resizing unconditionally enlarged a photo somebody had saved
  // from a chat app to 1440px of interpolated pixels and then re-encoded it,
  // turning a 60KB file into a few hundred KB that looked softer than the
  // original — paid for on whatever wifi they are actually on.
  if (size == null || size.width > MAX_DIMENSION) {
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
