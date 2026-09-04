import fs from 'node:fs';
import path from 'node:path';

import { after, between } from '@/lib/__tests__/source';

/**
 * The photo somebody just picked is on screen, and it survives a bad wifi.
 *
 * Source assertions rather than a render, for the reason the chat's own photo
 * test gives: what these pin is WIRING. The grid's failure branch is reached
 * only by an upload that throws, the tile it draws is the local file rather
 * than anything a query returns, and the flash this guards against is a
 * refetch landing a frame late. None of that has a rendered form a component
 * test could reach without mocking the thing under test.
 *
 * The pictures are the proof it looks right: the e2e tour shoots the tile
 * mid-upload (54b-photo-uploading).
 */
const read = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const grid = read('photo-grid.tsx');
const hooks = read('..', 'features', 'profile', 'hooks.ts');
const profileMe = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'profile-me.tsx'),
  'utf8'
);

describe('an upload has a tile of its own', () => {
  it('holds the picked file, its slot and what is happening to it', () => {
    expect(grid).toContain("state: 'uploading' | 'failed'");
    expect(grid).toContain('localUri: string');
  });

  it('draws the picked photo, not a spinner in an empty box', () => {
    expect(grid).toContain('source={{ uri: upload.localUri }}');
    // The old grid put an ActivityIndicator in every empty dashed tile
    // because `busy` was one boolean for the whole grid.
    expect(grid).not.toContain('ActivityIndicator');
    expect(grid).not.toContain('busy={uploadPhoto.isPending}');
  });

  it('keeps the file when the upload fails, and offers the retry there', () => {
    // No Alert: an alert on top of the tile was one more dismissal between
    // the person and the one thing worth doing.
    expect(grid).not.toContain("Alert.alert('Upload failed'");
    expect(grid).toMatch(/catch \{[\s\S]{0,400}?state: 'failed'/);
    expect(grid).toContain('onRetry={() => send(pendingMain.localUri, 0)}');
    expect(grid).toContain('was not sent. Tap to try again.');
  });

  it('holds the tile until the ROW lands, not until the promise settles', () => {
    // invalidateQueries is a refetch. Dropping the local tile when
    // mutateAsync resolves flashes the empty dashed box back for its
    // duration — so the mutation RETURNS its invalidation, and the tile is
    // dropped after the await, with the real row already in the cache.
    expect(hooks).toContain(
      "return queryClient.invalidateQueries({ queryKey: ['photos', userId] })"
    );
    expect(grid).toContain('await uploadPhoto.mutateAsync({ localUri, position })');
  });

  it('retires a finished upload by identity, so it cannot come back', () => {
    // The bug this replaces: entries were only ever HIDDEN, by asking whether
    // a row occupied their slot. Upload to slot 0 on the mandatory signup
    // step, then delete that photo, and the finished upload reappeared as an
    // 'Uploading' tile over an empty slot that would never finish.
    expect(grid).toContain('setPending((list) => list.filter((item) => item.token !== token))');
    // By token and never by slot, because a delete or a reorder between the
    // picker closing and the upload resolving moves what lives at a position.
    expect(grid).toContain('list.map((item) => (item.token === token ?');
    expect(grid).not.toMatch(/item\.position === position \? \{ \.\.\.item, state:/);
    // And nothing left in the list is a finished upload waiting for its slot.
    expect(grid).toContain('const active = pending;');
  });

  it('counts a slot with an upload in it as taken', () => {
    expect(grid).toContain('...active.map((p) => p.position)');
  });

  it('says how many photos there is room for', () => {
    expect(grid).toContain('{occupied} of {PHOTOS_MAX}');
  });
});

describe('the owner is not asked for a photo they just added', () => {
  it('shows the one photo still being checked in the hero', () => {
    expect(profileMe).toContain('const checkingHero =');
    expect(profileMe).toContain('photoChecking={checkingHero != null}');
    expect(profileMe).toContain(
      'const visiblePhotos = checkingHero ? [checkingHero] : approvedPhotos;'
    );
  });

  it('still counts a held photo as held, so the notice stays', () => {
    expect(profileMe).toContain('const heldBack = photos.length - approvedPhotos.length;');
  });
});

/**
 * The badge follows the face (20260904100000): a delete or a reorder can
 * take profiles.verified off server-side, in the same statement, with the
 * approved verification turned into a rejected one that carries a reason.
 * Neither of those lives under the photos key, so a hook that refetched only
 * the photos left the profile screen holding a seal the database had
 * withdrawn until something else happened to refetch it.
 *
 * Source assertions again, for the same reason as above: what is pinned is
 * which keys a mutation invalidates, and a render cannot see a key.
 */
describe('the badge can come off with a photo', () => {
  const deleteHook = between(
    hooks,
    'export function useDeletePhoto',
    'export function useReorderPhotos'
  );
  const reorderHook = between(
    hooks,
    'export function useReorderPhotos',
    'export function usePhotoUrl'
  );
  const uploadHook = between(
    hooks,
    'export function useUploadPhoto',
    'export function useDeletePhoto'
  );

  it('refetches the profile and the verification after a delete', () => {
    expect(deleteHook).toContain(
      "queryClient.invalidateQueries({ queryKey: ['profile', userId] })"
    );
    expect(deleteHook).toContain(
      "queryClient.invalidateQueries({ queryKey: ['verification', userId] })"
    );
  });

  it('and after a reorder, whatever the outcome', () => {
    // onSettled, not onSuccess: the revoke happens inside the same statement
    // as the position write, so it is there whether or not a later write of
    // the same plan failed. onSettled is the last handler of that mutation,
    // so everything after the anchor is its body.
    const settled = after(reorderHook, 'onSettled');
    expect(settled).toContain("queryClient.invalidateQueries({ queryKey: ['profile', userId] })");
    expect(settled).toContain(
      "queryClient.invalidateQueries({ queryKey: ['verification', userId] })"
    );
  });

  it('but not after an upload, which lands pending and cannot move a badge', () => {
    expect(uploadHook).not.toContain("['profile', userId]");
    expect(uploadHook).not.toContain("['verification', userId]");
  });

  it('says so on the main tile before the tap, only while there is a badge to lose', () => {
    expect(grid).toContain('useOwnProfile');
    expect(grid).toContain(
      "'Your badge may come off, since it was checked against this photo. A new selfie brings it back.'"
    );
    expect(grid).toMatch(/main && profile\?\.verified\s*\?/);
  });
});
