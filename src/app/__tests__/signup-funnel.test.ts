import fs from 'node:fs';
import path from 'node:path';

import { SIGNUP_TOTAL_STEPS, signupStepName } from '@/features/signup/steps';
import { between } from '@/lib/__tests__/source';

/**
 * Every signup step emits one funnel event, in one schema.
 *
 * Six of the thirteen steps used to emit nothing — including the photo gate
 * with its three iOS permission dialogs and the trip step that decides
 * whether a profile is visible to matching at all — and the two that did
 * sent a string where the rest sent an integer, so a PostHog breakdown on
 * `step` returned an unorderable mixed axis and no funnel chart could be
 * drawn. The fix moved the capture into go(), the one door every step leaves
 * through; what this file guards is that it stays there, alone, and that
 * every call site keeps the `{ step_index, step_name }` shape the funnel
 * orders by.
 *
 * Source assertions in the shape of step-flow.test.ts's shell parser: what
 * would go wrong is a handler that stops routing through go(), or a capture
 * creeping back into saveAndGo and double-counting the four steps that save.
 */
const stripped = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
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

describe('every onboarding step leaves through the instrumented door', () => {
  const code = stripped('onboarding', 'index.tsx');
  const found = shells(code);

  it('found the thirteen-step flow', () => {
    expect(found.length).toBeGreaterThan(5);
  });

  it.each(found.map((s) => [s.step, s] as const))(
    'step %i advances through go()',
    (step, shell) => {
      const onContinue = attribute(shell.body, 'onContinue');
      expect(onContinue).not.toBeNull();
      if (step === SIGNUP_TOTAL_STEPS) {
        // The last step's exit is the completion stamp, whose own event is
        // onboarding_completed — that closes the funnel end to end.
        expect(code).toContain("analytics.capture('onboarding_completed')");
        return;
      }
      // saveAndGo calls go(), so either spelling reaches the capture. The
      // prompt/priority/trip steps route their empty branch to an editor and
      // still go() on the filled one.
      expect(onContinue).toMatch(/\b(saveAndGo|go)\(/);
      const onSkip = attribute(shell.body, 'onSkip');
      if (onSkip != null) {
        expect(onSkip).toMatch(/\bgo\(\d+, \{ skipped: true \}\)/);
      }
    }
  );

  it('saveAndGo no longer captures anything of its own', () => {
    // go() runs inside saveAndGo, so a second capture here emits twice for
    // every step that saves.
    const saveAndGo = between(code, 'const saveAndGo', 'const signOutFooter');
    expect(saveAndGo).not.toContain('analytics.capture');
  });

  it('go() emits only on a forward move, with the schema fields', () => {
    const go = between(code, 'const go =', 'const saveAndGo');
    expect(go).toContain('next > step');
    expect(go).toContain('step_index: step');
    expect(go).toContain('step_name: signupStepName(step)');
    expect(go).toContain('skipped');
  });
});

describe('one schema across every call site', () => {
  const SRC = path.join(__dirname, '..', '..');

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '__tests__' ? [] : walk(full);
      }
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });

  /** Every capture of the two step events, with the argument text. */
  const sites: { file: string; args: string }[] = [];
  for (const file of walk(SRC)) {
    const code = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const pattern = /capture\(\s*'(?:signup|business)_step_completed'\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    for (const match of code.matchAll(pattern)) {
      sites.push({ file: path.relative(SRC, file), args: match[1] });
    }
  }

  it('found the call sites', () => {
    // join's two literal steps, onboarding's go(), business-signup's go().
    expect(sites.length).toBeGreaterThanOrEqual(4);
  });

  it('every site sends step_index and step_name, and never a bare step:', () => {
    for (const site of sites) {
      expect(site.args).toContain('step_index:');
      expect(site.args).toContain('step_name:');
      // The mixed axis this schema replaced: `step:` carried a string on two
      // screens and an integer on four others.
      expect(site.args).not.toMatch(/\bstep:/);
    }
  });

  it('the literal sites are numeric indices with string names', () => {
    const literal = sites.filter((site) => /step_index:\s*\d+/.test(site.args));
    expect(literal.length).toBeGreaterThanOrEqual(2);
    for (const site of literal) {
      expect(site.args).toMatch(/step_name:\s*'[a-z]+'/);
    }
  });

  it('apple is its own event, not a step', () => {
    const apple = stripped('..', 'features', 'auth', 'apple-button.tsx');
    expect(apple).not.toContain('signup_step_completed');
    expect(apple).toContain("analytics.capture('signup_apple_used')");
  });

  it('arrival has a denominator', () => {
    const join = stripped('(auth)', 'join.tsx');
    expect(join).toContain("capture('signup_started', { business: forBusiness })");
  });
});

describe('the fourteen steps have fourteen stable names', () => {
  it('names every step, in order', () => {
    const names = Array.from({ length: SIGNUP_TOTAL_STEPS }, (_, i) => signupStepName(i + 1));
    expect(names).toEqual([
      'email',
      'password',
      'who',
      'home',
      'photo',
      'occupation',
      'bio',
      'prompts',
      'priorities',
      'trip',
      'socials',
      'badge',
      'audience',
      'review',
    ]);
  });
});
