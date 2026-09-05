import fs from 'node:fs';
import path from 'node:path';

const code = fs.readFileSync(path.join(__dirname, '..', 'incoming-request-card.tsx'), 'utf8');

/**
 * The card where a stranger's words arrive unasked-for, and the two answers
 * to them.
 *
 * Source assertions, because every guarantee below is about wiring a render
 * test cannot see: which element owns a tap, which lifecycle event writes a
 * decision, and which copy of a Text is the one being measured.
 */
describe('the fold on an incoming hello', () => {
  it('puts the words that name the action inside the thing that performs it', () => {
    // The affordance was a SIBLING of the Pressable it toggles, so tapping
    // "Show the whole message" did nothing at all: the one part of the card
    // that says what the tap does was the one part that could not do it.
    const press = code.indexOf('onPress={() => setExpanded((open) => !open)}');
    const affordance = code.indexOf("{expanded ? 'Show less' : 'Show the whole message'}");
    const closesPressable = code.indexOf('</Pressable>', press);
    expect(press).toBeGreaterThan(-1);
    expect(affordance).toBeGreaterThan(press);
    expect(affordance).toBeLessThan(closesPressable);
  });

  it('measures the message unclamped, so four lines is not "folded"', () => {
    // React Native reports lines AFTER truncation, so onTextLayout on the
    // clamped Text can never answer more than MESSAGE_LINES: a message of
    // exactly four lines was marked folded and offered a dead affordance.
    // The measuring copy carries no numberOfLines, and the comparison is
    // strictly greater.
    expect(code).toContain('setFolded(event.nativeEvent.lines.length > MESSAGE_LINES);');
    expect(code).not.toContain('lines.length >= MESSAGE_LINES');
    // Out of flow and silent, so it changes no layout and is not read twice.
    expect(code).toContain('accessibilityElementsHidden');
    expect(code).toContain('importantForAccessibility="no-hide-descendants"');
    expect(code).toContain('{measured ? null : (');
  });
});

describe('the deferred decline', () => {
  it('says the transition out loud', () => {
    // The activated button is unmounted by this very change, so VoiceOver
    // focus is dropped and a reader is left with no idea whether the decline
    // landed or that there is a way back from it.
    expect(code).toContain(
      "useAnnounce(declined ? 'Declined. You can undo for five seconds.' : null);"
    );
  });

  it('stops reading as a decline when the write did not land', () => {
    // Offline, or a row already gone: the card used to sit on "Declined"
    // for ever while the hello was still in the inbox on the next launch.
    expect(code).toContain('onError: () => {');
    expect(code).toContain('setDeclined(false);');
  });

  it('writes on the way out of the foreground, not only on a timer', () => {
    // iOS gives an app no notice of a swipe-up kill, so leaving 'active' is
    // the last moment anything can be written — and it is the same moment
    // the reader stops being able to undo.
    expect(code).toContain("AppState.addEventListener('change'");
    expect(code).toContain("if (next !== 'active') {");
    expect(code).toContain('flush.current();');
  });

  it('flushes through one path, so the three callers cannot drift', () => {
    // The timer, the unmount, and the app leaving the foreground all write
    // the same decline the same way.
    expect(code.match(/flush\.current\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
