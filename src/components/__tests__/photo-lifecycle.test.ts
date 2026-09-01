import fs from 'node:fs';
import path from 'node:path';

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
