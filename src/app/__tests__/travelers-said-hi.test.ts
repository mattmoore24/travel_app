import fs from 'node:fs';
import path from 'node:path';

/**
 * What happens on Travelers after the highest-intent tap in the product.
 *
 * It used to be nothing: the composer's confirmation popped after 1100ms, a
 * different stranger's face had silently taken the page underneath, and
 * there was no trace anywhere on the tab that anything had been said. The
 * strip is the beat that was missing — and it must stay a beat, floating
 * over the next traveler rather than a state they get stuck behind.
 *
 * Source assertions, because what is guarded is where the strip sits and
 * what it refuses to offer, and neither is visible to a render test.
 */
const strip = (file: string) =>
  fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const screen = strip(path.join(__dirname, '..', '(tabs)', 'travelers.tsx'));

describe('the beat after a hello', () => {
  it('says who it went to and where it now lives', () => {
    expect(screen).toContain('`Said hi to ${name}. It\'s in Chat under "You said hi".`');
  });

  it('offers no link to a conversation that does not exist yet', () => {
    // A hello is a message_request behind the accept gate and passes
    // moderation before delivery, so there is no chat id at this moment and
    // a "Go to chat" button would be a dead tap.
    expect(screen).not.toContain('Go to chat');
    expect(screen).not.toMatch(/router\.push\(`\/chat\/\$\{/);
  });

  it('floats in the action bar slot without gating the next traveler', () => {
    expect(screen).toContain('style={[styles.undoDock, { bottom }]}');
    expect(screen).toContain('pointerEvents="box-none"');
  });

  it('survives the queue emptying, which is what saying hi to the last one does', () => {
    // Saying hi invalidates sent-requests, sentByRecipient drops the
    // recipient, and the queue hits zero — so the empty wall IS the screen a
    // confirmation of the last hello has to land on. The derivation sits
    // above that early return and the strip renders on both branches.
    const derived = screen.indexOf('const showSaidHi =');
    const earlyReturn = screen.indexOf('if (queue.length === 0 || !current) {');
    expect(derived).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(derived);
    expect(screen.match(/<SaidHiStrip /g)).toHaveLength(2);
    // No measured bar under the wall, so that branch stands on the formula
    // the action bar would have used.
    expect(screen).toContain('bottom={dockedActionBarHeight(dockBottom)}');
    expect(screen).toContain('bottom={barHeight}');
  });

  it('paints only for a hello that left from THIS tab', () => {
    // useSendRequest is the app's only send path: the map's pin card and a
    // stranger's profile go through it too, and nothing but this screen ever
    // clears the store. Unfiltered, a hello sent from the map an hour ago
    // painted a strip here claiming it had just happened.
    expect(screen).toContain("saidHiTo.origin === 'travelers'");
  });

  it('refuses to paint a stale stamp at all', () => {
    // The dismissal timer runs on FOCUS, so a stamp made while this tab was
    // off-stage was never counted down. The age guard is what makes that
    // unpaintable rather than merely unlikely — and it is decided in the
    // effect, not in render, so the flag starts false and a stale stamp has
    // no frame to appear in. Reading the clock during render would be
    // impure anyway.
    expect(screen).toContain('const left = SAID_HI_MS - (Date.now() - saidHiTo.at);');
    expect(screen).toContain('setSaidHiFresh(false);');
    expect(screen).toContain('saidHiFresh &&');
  });

  it('shares that slot with the undo bar, newer act first', () => {
    // Two transient bars on one number: without this they land on top of
    // each other. Derived from the timestamps rather than reconciled in an
    // effect, so the two can never get out of step.
    expect(screen).toContain('(undo == null || saidHiTo.at >= undo.at)');
    expect(screen).toContain('{showSaidHi && saidHiTo ? (');
    expect(screen).toContain('{undo && !showSaidHi ? (');
  });

  it('clears itself on a timer and on the way to Chat', () => {
    // The timer spends what is LEFT of the beat, not a fresh four seconds:
    // it runs on focus, so a strip that was already half-read when the tab
    // was left has to finish rather than start again.
    expect(screen).toContain('const SAID_HI_MS = 4000;');
    expect(screen).toContain('setTimeout(() => useSaidHi.getState().clear(), left)');
    expect(screen).toContain("router.navigate('/chat')");
  });
});
