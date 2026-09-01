import type { ImageSource } from 'expo-image';

/**
 * Pair a signed URL with the one thing about that photo which never changes.
 *
 * WHY THIS EXISTS. Every photo in this app lives in a private bucket and is
 * read through a signed URL, and a signed URL carries an expiry and a
 * signature in its query string. `usePhotoUrl` signs for an hour,
 * `useBusinessPhotoUrl` for fifty minutes, `useChatPhotoUrl` for its own
 * window, and none of that survives a process restart because the query
 * cache has no persister. So a cold launch re-signs every path it needs and
 * gets back a URL that is different in the query string and identical in the
 * bytes it points at.
 *
 * expo-image keys its disk cache on the source `uri` unless it is told
 * otherwise (`cacheKey` on `ImageSource`, verified against
 * node_modules/expo-image/build/Image.types.d.ts:49 at 57.0.3). A new URL is
 * therefore a cache MISS on a file the phone already holds byte for byte,
 * and a pass through Travelers, the chat list and two profiles re-pulls a
 * dozen 1440px JPEGs. That is the difference between a screen that appears
 * and a screen of grey rectangles on hostel wifi, once per launch and again
 * fifty minutes into a long session.
 *
 * The storage path is the stable half: `<user_id>/<random>.jpg`, written
 * once by `processAndUploadImage` and never reused — the id is 16 bytes from
 * `crypto.getRandomValues` and every upload mints a fresh one, so no path is
 * ever handed a second set of bytes. That is exactly the property a cache key
 * needs, and it is the property to check before anything is ever allowed to
 * write to a path that already exists: an edit-in-place would serve the old
 * photo forever, silently, with no way for a reader to tell.
 *
 * The path is not qualified by bucket. Two buckets could in principle hold
 * the same path, which would need the same user to draw the same 128-bit
 * random twice; if a bucket ever starts naming objects by something
 * predictable, this has to become `${bucket}/${path}`.
 */
export function photoSource(
  uri: string | null | undefined,
  storagePath: string | null | undefined
): ImageSource | null {
  if (uri == null || uri === '') {
    // Null rather than `{ uri: undefined }`, so a caller can write
    // `photo ? <Image source={photo} /> : <Skeleton />` and keep the
    // loading state it already had.
    return null;
  }
  if (storagePath == null || storagePath === '') {
    // No stable half to key on: leave expo-image to key on the URL, which is
    // what every call site did before this helper existed.
    return { uri };
  }
  return { uri, cacheKey: storagePath };
}
