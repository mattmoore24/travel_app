import fs from 'node:fs';
import path from 'node:path';

/**
 * Continue goes forward. Back goes back. One step at a time.
 *
 * Written after `Where is it?` shipped with `onContinue={... go(3)}` — step 4
 * sending an owner to step 3 — which made the founder's "Is this right?"
 * confirm screen unreachable and turned the middle of business signup into a
 * loop with no way out. Every check here passes on that bug's fix and fails
 * on the bug, which is the only reason it exists.
 *
 * Source assertions rather than a render test because what is wrong is the
 * NUMBER in a handler. Rendering step 4 and pressing Continue would need the
 * launch cities, a map, and a geocoder, and would still only cover the one
 * step somebody thought to write a case for.
 */
const stripped = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    // Comments quote step numbers while explaining them, including the bug
    // report above the fix. Reading them as code would make this test lie.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Each `<StepShell` block, from its tag to the start of the next one. */
function shells(code: string): { step: number; body: string }[] {
  const out: { step: number; body: string }[] = [];
  const starts: number[] = [];
  for (let i = code.indexOf('<StepShell'); i > -1; i = code.indexOf('<StepShell', i + 1)) {
    starts.push(i);
  }
  starts.forEach((start, i) => {
    const body = code.slice(start, starts[i + 1] ?? code.length);
    const step = body.match(/step=\{(\d+)\}/);
    if (step) {
      out.push({ step: Number(step[1]), body });
    }
  });
  return out;
}

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

const targets = (value: string | null): number[] =>
  value == null ? [] : [...value.matchAll(/\bgo\((\d+)\)/g)].map((m) => Number(m[1]));

describe.each([
  ['a person', stripped('onboarding', 'index.tsx')],
  ['a business', stripped('business-signup.tsx')],
])('%s never gets sent backwards by Continue', (_who, code) => {
  const found = shells(code);

  it('has more than one step to check', () => {
    expect(found.length).toBeGreaterThan(5);
  });

  it.each(found.map((s) => [s.step, s] as const))('step %i moves on', (step, shell) => {
    for (const name of ['onContinue', 'onSkip']) {
      const moves = targets(attribute(shell.body, name));
      if (moves.length === 0) {
        // Either the step has no such handler, or it hands off to a named
        // function (register, saveContacts, sendCode) that owns the move.
        continue;
      }
      expect(Math.max(...moves)).toBeGreaterThan(step);
    }
  });

  it.each(found.filter((s) => s.step > 3).map((s) => [s.step, s] as const))(
    'step %i goes back exactly one',
    (step, shell) => {
      const back = targets(attribute(shell.body, 'onBack'));
      // Step 3 is the first in each flow and backs out of the stack instead.
      expect(back).toEqual([step - 1]);
    }
  );
});
