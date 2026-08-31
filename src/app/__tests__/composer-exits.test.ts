import fs from 'node:fs';
import path from 'node:path';

/**
 * Every composer announces a way out.
 *
 * compose-request was the only one of the three composers that never passed
 * onClose to StepScreen, so the sole exit from the app's most important
 * modal was the iOS sheet swipe: no announced control for VoiceOver, and a
 * drag the multiline field and the ScrollView can swallow. A source scan
 * (the step-flow.test.ts technique) because what is wrong is a missing JSX
 * attribute, not behaviour a render test would need a router for.
 */

const stripped = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** The value of a JSX attribute, brace-balanced so nested arrows survive. */
function attribute(body: string, name: string): string | null {
  const at = body.indexOf(`${name}={`);
  if (at === -1) {
    return null;
  }
  let depth = 0;
  for (let i = at + name.length + 1; i < body.length; i += 1) {
    if (body[i] === '{') {
      depth += 1;
    } else if (body[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return body.slice(at + name.length + 1, i + 1);
      }
    }
  }
  return null;
}

describe.each([
  ['saying hi', stripped('compose-request.tsx')],
  ['messaging a group-mate', stripped('message', '[userId].tsx')],
  ['writing to a business', stripped('message-place.tsx')],
])('%s', (_which, code) => {
  it('passes onClose to StepScreen', () => {
    const shell = code.slice(code.indexOf('<StepScreen'));
    expect(shell).not.toBe('');
    expect(attribute(shell, 'onClose')).not.toBeNull();
  });
});

it('the say-hi close cancels the confirmation timer before leaving', () => {
  // Leaving early used to leave the CONFIRM_MS timer running, which then
  // popped the screen UNDERNEATH. The unmount effect clears it; the close
  // handler must too, because closing navigates before unmounting settles.
  const code = stripped('compose-request.tsx');
  const leave = code.slice(code.indexOf('const leave'), code.indexOf('const requestClose'));
  expect(leave).toContain('clearTimeout(backTimer.current)');
});
