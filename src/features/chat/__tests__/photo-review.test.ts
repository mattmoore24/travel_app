import fs from 'node:fs';
import path from 'node:path';

/**
 * A photo says it is being checked, and its caption travels with it.
 *
 * Two separate defects wore the same disguise. A photo and the words under it
 * were two inserts, and they landed in the OPPOSITE order to the one they were
 * written in — text goes straight through, a photo waits for a verdict — so a
 * picture captioned "look at this" delivered the caption first and the image
 * some seconds later, underneath it. And the wait itself was drawn as the
 * words "Photo in review" in a text bubble, a small grey rectangle that then
 * jumped to 220pt square: the founder's "tiny bubble".
 *
 * Source assertions, because both are about wiring rather than output: a
 * render test cannot see that two inserts became one, and the realtime
 * subscription that resolves the tile has no rendered form at all.
 */
const source = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const app = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', '..', '..', 'app', ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('a photo and its caption are one message', () => {
  it('sends both fields in a single insert', () => {
    const code = source('api.ts');
    expect(code).toMatch(/sendPhotoMessage\([\s\S]*?body\?: string\s*\)/);
    expect(code).toContain('...(caption.length > 0 ? { body: caption } : {})');
  });

  it('never follows a photo with a second send of the same words', () => {
    for (const screen of [app('chat', '[id].tsx'), app('room', '[id].tsx')]) {
      // The `return` after the photo send is the whole guarantee: without it
      // the caption goes twice, once attached and once on its own.
      expect(screen).toMatch(
        /await sendPhoto\.mutateAsync\(\{ localUri: photoUri, body: text \}\)[\s\S]{0,400}?return;/
      );
    }
  });
});

describe('the wait is drawn, not hidden', () => {
  it('reserves the photo’s real frame while it is checked', () => {
    const code = source('message-thread.tsx');
    expect(code).toContain('function PhotoCheck(');
    // Same style as a delivered photo, so nothing in the thread moves when
    // the verdict lands.
    expect(code).toContain('style={[styles.photo, styles.photoCheck');
    expect(code).not.toContain('Photo in review');
  });

  it('says how long it usually takes, from one number', () => {
    const code = source('message-thread.tsx');
    expect(code).toContain('const PHOTO_CHECK_SECONDS =');
    expect(code).toContain('Usually about {PHOTO_CHECK_SECONDS} seconds.');
  });

  it('keys the tile off the state, not off a path a room masks', () => {
    // A room withholds image_path from everybody but the sender until the
    // verdict lands, so keying off the path drew nothing at all for the rest
    // of the group — which is the empty bubble people were looking at.
    const code = source('message-thread.tsx');
    expect(code).toContain("const checking = message.moderation_status === 'pending'");
    expect(code).toMatch(/\{checking \? \(\s*<PhotoCheck/);
  });

  it('listens for the update that clears it, not only for inserts', () => {
    // A verdict is an UPDATE. With INSERT alone the tile sat there until
    // something else happened in the conversation.
    expect(source('api.ts')).toContain("{ event: '*', schema: 'public', table: 'messages'");
    expect(source('..', 'rooms', 'api.ts')).toContain(
      "{ event: '*', schema: 'public', table: 'messages'"
    );
  });
});

describe('the delivery ladder is complete', () => {
  const code = source('message-thread.tsx');

  it('says Sent under the newest of your own messages that landed', () => {
    expect(code).toContain(
      'messages.find((m) => m.sender_id === ownUserId && m.local == null)?.id ?? null'
    );
    expect(code).toContain("? 'Sending…'");
    expect(code).toContain(": 'Sent'}");
  });

  it('never calls a photo Sent while it is still being checked', () => {
    expect(code).toContain("delivered && message.moderation_status !== 'pending'");
  });
});
