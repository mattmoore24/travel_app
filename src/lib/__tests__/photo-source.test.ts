/**
 * A signed URL is not a cache key. The whole value of `photoSource` is that
 * the key it hands expo-image is the STORAGE PATH — the half of a photo's
 * identity that survives a relaunch — and the failure it prevents is silent:
 * every assertion below passes just as happily on a version that keys on the
 * URL, right up until somebody reads which value came back.
 */
import { photoSource } from '@/lib/photo-source';

const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/profile-photos/u1/abc.jpg?token=eyJ1';
const RESIGNED =
  'https://x.supabase.co/storage/v1/object/sign/profile-photos/u1/abc.jpg?token=eyJ2';
const PATH = 'u1/abc.jpg';

describe('a photo carries both halves of its identity', () => {
  it('hands expo-image the URL to fetch and the path to remember it by', () => {
    expect(photoSource(SIGNED, PATH)).toEqual({ uri: SIGNED, cacheKey: PATH });
  });

  it('keys on the storage path, never on the signed URL', () => {
    // The assertion this file exists for. Two signings of the same object
    // differ in the query string and are the same bytes; keyed on the URL
    // they are two cache entries and the second one is a download.
    const first = photoSource(SIGNED, PATH);
    const second = photoSource(RESIGNED, PATH);
    expect(first?.cacheKey).toBe(PATH);
    expect(second?.cacheKey).toBe(PATH);
    expect(first?.cacheKey).toBe(second?.cacheKey);
    expect(first?.uri).not.toBe(second?.uri);
    expect(first?.cacheKey).not.toContain('token=');
  });

  it('is null while the URL is still being signed, so a caller keeps its skeleton', () => {
    // usePhotoUrl's `data` is undefined before the query settles and the
    // screens render a Skeleton on exactly that. Null preserves it; an object
    // with no uri would render an empty image instead.
    expect(photoSource(undefined, PATH)).toBeNull();
    expect(photoSource(null, PATH)).toBeNull();
    expect(photoSource('', PATH)).toBeNull();
  });

  it('falls back to expo-image keying on the URL when there is no path', () => {
    // A local file:// picked from the library has no storage path yet. It
    // must still render, and it must not be given a bogus key.
    expect(photoSource('file:///tmp/pick.jpg', null)).toEqual({ uri: 'file:///tmp/pick.jpg' });
    expect(photoSource('file:///tmp/pick.jpg', null)).not.toHaveProperty('cacheKey');
    expect(photoSource(SIGNED, undefined)).toEqual({ uri: SIGNED });
    expect(photoSource(SIGNED, '')).toEqual({ uri: SIGNED });
  });
});
