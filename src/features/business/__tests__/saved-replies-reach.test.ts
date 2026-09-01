import fs from 'node:fs';
import path from 'node:path';

/**
 * The saved replies have to be writable AND usable.
 *
 * `business_saved_replies` shipped as a table, four policies and a pgTAP file
 * with zero client: no API, no screen, no chip. An owner could not write one
 * and could not use one. That is the fourth capability in three batches to
 * ship with nothing on the other end, so the reach is pinned here rather than
 * assumed — a render test of the composer proves the chip draws, not that
 * anybody can ever get one into it.
 */
const REPO = path.join(__dirname, '..', '..', '..', '..');
const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), 'utf8');

describe('an owner can write a saved reply', () => {
  it('has a screen, and a route to reach it', () => {
    const screen = read('src', 'app', 'saved-replies.tsx');
    expect(screen).toContain('useSetSavedReply');
    expect(read('src', 'app', '_layout.tsx')).toContain('name="saved-replies"');
  });

  it('has a door on My business', () => {
    const tab = read('src', 'app', '(tabs)', 'my-business.tsx');
    expect(tab).toContain("router.push('/saved-replies')");
    expect(tab).toContain('label="Quick replies"');
  });

  it('clears a slot rather than storing a blank', () => {
    // The table refuses length 0, and a chip with nothing on it is a control
    // that does nothing.
    const api = read('src', 'features', 'business', 'api.ts');
    const fn = api.slice(api.indexOf('export async function setSavedReply'));
    expect(fn.slice(0, fn.indexOf('upsert'))).toContain('.delete()');
    // Upsert on the table's own unique pair, so editing one slot twice cannot
    // leave two rows in it.
    expect(fn).toContain("onConflict: 'business_id,position'");
  });
});

describe('an owner can use one', () => {
  it('the composer takes them and the business chat passes them', () => {
    expect(read('src', 'features', 'chat', 'composer.tsx')).toContain('savedReplies');
    const chat = read('src', 'app', 'chat', '[id].tsx');
    expect(chat).toContain('savedReplies={savedReplies}');
    // Asked for only where they can be used: the table has no policy for a
    // traveler, so asking there is a round trip that can only come back empty.
    expect(chat).toContain('useSavedReplies(viewerIsBusiness ? ownBusinessId : null)');
  });

  it('puts the words in the field instead of sending them', () => {
    // These are private notes. A chip that sent on tap would turn a stored
    // sentence into a message nobody re-read, which is how a saved reply
    // answers the wrong question confidently.
    const composer = read('src', 'features', 'chat', 'composer.tsx');
    const chip = composer.slice(composer.indexOf('savedReplies && savedReplies.length'));
    const body = chip.slice(0, chip.indexOf('</ScrollView>'));
    expect(body).toContain('setDraft(reply.body)');
    expect(body).not.toContain('onSend');
  });

  it('gets out of the way once there is anything to send', () => {
    const composer = read('src', 'features', 'chat', 'composer.tsx');
    expect(composer).toContain('draft.length === 0');
  });
});
