import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { between, source } from '@/lib/__tests__/source';

/**
 * The four dashboard settings this repository can now set for itself.
 *
 * `.github/scripts/harden-project-settings.mjs` reaches the Supabase
 * Management API with a personal access token that can change anything about
 * the project, and its output goes into an Actions log on a PUBLIC repository.
 * Three things about it therefore have to stay true, and none of them is
 * observable at runtime — no test can call the live API, and a script that
 * quietly grew a `console.log(config)` would look exactly like one that had
 * not. So they are asserted in the text, the way the rest of this suite
 * asserts absences.
 *
 * The fourth check is a cross-file number: the storage ceiling the script sets
 * and the per-bucket limit the migration sets are the same 5 MB, and nothing
 * else would notice if they drifted apart.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const SCRIPT = '.github/scripts/harden-project-settings.mjs';
const WORKFLOW = '.github/workflows/harden-project-settings.yml';
const BUCKETS = 'supabase/migrations/20260906110000_a_bucket_says_what_it_takes.sql';

describe('the settings script only ever narrows the exposed schemas', () => {
  const code = source(SCRIPT);

  it('keeps public and graphql_public and nothing else', () => {
    expect(code).toContain("const ALLOWED_SCHEMAS = ['public', 'graphql_public'];");
  });

  it('filters the live list rather than writing one of its own', () => {
    const block = between(code, "name: 'SEC-002 exposed schemas", 'patch: (want)');
    // The desired value is a SUBSET of what is already there. A `push`, a
    // `concat` or a literal array would be this script adding an exposure,
    // which is the one thing it must never do — including adding back a
    // schema somebody removed on purpose.
    expect(block).toContain('current.filter((schema) => ALLOWED_SCHEMAS.includes(schema))');
    expect(block).not.toMatch(/\.push\(|\.concat\(|\.\.\.ALLOWED_SCHEMAS/);
  });

  it('refuses to write a list that has lost public', () => {
    // Filtering a list that somehow does not contain `public` leaves an empty
    // string, and an empty db_schema is a PostgREST that serves nothing: every
    // screen in the app, at once. The guard is the difference between this
    // script being safe to run unattended and it being a way to take the
    // product down from the Actions tab.
    const block = between(code, "name: 'SEC-002 exposed schemas", 'patch: (want)');
    expect(block).toContain("if (!kept.includes('public'))");
    expect(block).toContain('fail(');
  });
});

describe('the settings script prints no config values', () => {
  const code = source(SCRIPT);

  it('never logs a config document', () => {
    // The auth config GET carries security_captcha_secret,
    // sms_twilio_auth_token and twenty other provider secrets. The script may
    // hash a document and it may name its KEYS; it may never print one.
    // Paren-balanced, not a regex: half of these calls span several lines and
    // a lazy `.*?` would cut them off before the argument that matters.
    const logged: string[] = [];
    for (let i = code.indexOf('console.log('); i >= 0; i = code.indexOf('console.log(', i + 1)) {
      let depth = 0;
      let end = i;
      for (let j = code.indexOf('(', i); j < code.length; j += 1) {
        if (code[j] === '(') depth += 1;
        if (code[j] === ')') depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
      logged.push(code.slice(i, end + 1));
    }
    expect(logged.length).toBeGreaterThan(3);
    for (const call of logged) {
      // `beforePrint` and `afterPrint` are allowed through by the word
      // boundaries: they hold a hash and a key count, never a value.
      expect(call).not.toMatch(/\b(before|after|config)\b/);
    }
  });

  it('reports a mismatch as key names', () => {
    expect(code).toContain('changedKeys(before, after, owned)');
    expect(code).toContain('values are never printed');
  });
});

describe('the settings workflow is something somebody decides to run', () => {
  const yaml = source(WORKFLOW);

  it('fires on a request file and on nothing else', () => {
    // SEC-017 is this lesson from the other side: supabase-deploy.yml has no
    // branch filter, so anything that starts it starts it from anywhere. A
    // path-less `push:` here would run a project-settings change on every
    // commit to the branch. The one allowed path is a file whose only purpose
    // is to ask for the run.
    expect(yaml).toContain('workflow_dispatch:');
    const push = between(yaml, '  push:', '  workflow_dispatch:');
    expect(push).toContain('paths:');
    expect(push.match(/^\s+- '.*'$/gm)).toEqual(["      - '.github/harden-request'"]);
  });

  it('defaults to reading rather than writing', () => {
    const trigger = between(yaml, 'workflow_dispatch:', 'concurrency:');
    expect(trigger).toContain('default: check');
  });

  it('reads a push as a check unless the file says apply', () => {
    // A push carries no inputs. If the mode came through as empty the script
    // would take its own default, which is `apply` — so a stray commit to the
    // request path would write to the project. The step narrows anything that
    // is not the literal word to `check`.
    const step = between(yaml, 'name: Decide the mode', 'name: Set them');
    expect(step).toContain('if [ "$mode" != "apply" ]; then');
    expect(step).toContain('mode=check');
  });

  it('runs the script this test is about', () => {
    expect(yaml).toContain(`node ${SCRIPT}`);
  });
});

describe('the project storage ceiling and the bucket limits are the same number', () => {
  it('both say 5 MB', () => {
    // The project ceiling is what a bucket added later without limits
    // inherits; the per-bucket limit is what the five buckets that exist
    // carry. Two places, one number, and no way to notice it drifting except
    // an upload failing on a phone.
    expect(source(SCRIPT)).toContain('const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;');
    expect(source(BUCKETS)).toContain('set file_size_limit = 5 * 1024 * 1024,');
  });
});

/**
 * The script's decisions, watched rather than read.
 *
 * Everything above is a text scan, which is the right tool for an absence and
 * the wrong one for behaviour. This block runs the real script as a whole
 * program against a fake project (`.github/scripts/__fixtures__/`), because
 * that is how the workflow runs it and because there is no unit seam to reach
 * into: top-level await, env in, `process.exit` out.
 *
 * The `replace` scenario is the one worth the spawn. It answers a question the
 * OpenAPI spec cannot — whether PATCH merges or replaces — by making the fake
 * project replace, and proves the fingerprint catches it. If Supabase ever
 * changes that behaviour on the live API the script will fail the same way,
 * loudly, instead of quietly resetting `max_rows` and the search path.
 */
describe('the settings script, run end to end against a fake project', () => {
  const run = (scenario: string, mode = 'apply') => {
    const result = spawnSync(
      process.execPath,
      [path.join(REPO, '.github/scripts/__fixtures__/harden-project-settings.stub.mjs'), scenario],
      { encoding: 'utf8', env: { ...process.env, MODE: mode }, timeout: 60_000 }
    );
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  };

  it('narrows a dirty project and leaves the keys it does not own alone', () => {
    const { code, out } = run('dirty');
    expect(code).toBe(0);
    expect(out).toContain('ENDED db_schema=public, graphql_public');
    expect(out).toContain('ENDED hibp=true');
    expect(out).toContain('ENDED fileSizeLimit=5242880');
    expect(out).toContain('ENDED max_rows=1000');
  });

  it('never turns anonymous sign-ins off, because guest mode is built on them', () => {
    // THE ONE THE AUDIT GOT WRONG. SECURITY_AUDIT.md recorded that the app
    // does not use Supabase's anonymous-sign-in feature; `signInAsGuest` in
    // src/features/auth/api.ts IS `supabase.auth.signInAnonymously()`, and
    // `is_anonymous` is what routing, the tab layout and the guest hooks read
    // to tell a guest from a member. Writing `false` here would have taken
    // down the app's front door, so the section is a read and this is what
    // holds it that way.
    for (const scenario of ['dirty', 'clean', 'tight']) {
      const { out } = run(scenario);
      expect(out).toContain('ENDED anonymous=true');
      expect(out).toContain('ON, which is correct');
    }
  });

  it('fails loudly when anonymous sign-ins are off, and still writes nothing', () => {
    // A real failure, unlike the plan-blocked one above: somebody turned this
    // off and the guest door is broken until it goes back on.
    const { code, out } = run('noguests');
    expect(code).toBe(1);
    expect(out).toContain('Guest mode is built on this');
    // Reported, not "repaired": a script that flipped it back would be writing
    // to auth on the strength of its own opinion.
    expect(out).toContain('ENDED anonymous=false');
  });

  it('changes nothing when the project is already right', () => {
    const { code, out } = run('clean');
    expect(code).toBe(0);
    // Three writable settings say so; the fourth is the anonymous sign-ins
    // guard, which reports rather than changes and never says this.
    expect(out.match(/Nothing to change\./g)).toHaveLength(3);
    expect(out).toContain('Not changed.');
  });

  it('writes nothing in check mode', () => {
    const { code, out } = run('dirty', 'check');
    expect(code).toBe(0);
    expect(out).toContain('would change');
    // The fake project is untouched: this is the whole promise of check mode.
    expect(out).toContain('ENDED db_schema=public, graphql_public, net, storage');
    expect(out).toContain('ENDED hibp=false');
    expect(out).toContain('ENDED fileSizeLimit=52428800');
    expect(out).not.toContain('verified against a fresh read');
  });

  it('refuses a schema list that has lost public, and writes nothing at all', () => {
    const { code, out } = run('nopublic');
    expect(code).toBe(1);
    expect(out).toContain("does not include 'public'");
    expect(out).toContain('ENDED db_schema=net, storage');
    // It fails on the FIRST section, so the later ones never ran either.
    expect(out).toContain('ENDED hibp=false');
  });

  it('leaves a ceiling that is already tighter than 5 MB alone', () => {
    // Lowered only, never raised. A project someone had deliberately set to
    // 1 MB must not come out of this run at 5.
    const { code, out } = run('tight');
    expect(code).toBe(0);
    expect(out).toContain('ENDED fileSizeLimit=1048576');
    expect(out).toContain('already 1048576. Nothing to change.');
  });

  it('records a refused write and keeps going, instead of ending the run', () => {
    // THE ONE THE FIRST APPLY RUN TAUGHT. `password_hibp_enabled` came back 402
    // ("available on Pro Plans and up"), the API helper called fail(), node
    // exited, and the storage ceiling behind it was never attempted - which is
    // precisely the failure the results table exists to prevent. A refusal is a
    // result now.
    const { code, out } = run('freeplan');
    expect(out).toContain('the write was refused: 402');
    expect(out).toContain('a decision about the plan, not a setting to retry');
    // Everything either side of the refusal still ran.
    expect(out).toContain('ENDED db_schema=public, graphql_public');
    expect(out).toContain('ENDED fileSizeLimit=5242880');
    expect(out).toContain('ENDED hibp=false');
    // And it is a WARNING, not a failure. supabase-deploy.yml's Apple step
    // wrote this rule down first: "a deploy that goes red for an outstanding
    // founder errand teaches people to read red as weather." A 402 cannot be
    // fixed by re-running, so a permanently red run would train exactly that.
    expect(code).toBe(0);
    expect(out).toContain('::warning::SEC-004');
    expect(out).toContain('NOT a failure of this run');
  });

  it('treats a 200 with an empty body as a write, and lets the read-back settle it', () => {
    // PATCH /config/storage really does answer 200 with nothing in it. The
    // first corrected apply run read that as a refusal and reported the ceiling
    // unchanged without looking. Nothing here uses a PATCH's response body; the
    // read-back GET is the authority.
    const { code, out } = run('quietok');
    expect(code).toBe(0);
    expect(out).toContain('ENDED fileSizeLimit=5242880');
    expect(out).toContain('ENDED db_schema=public, graphql_public');
    expect(out).not.toContain('the body was not JSON');
  });

  it('catches a PATCH that replaces the document instead of merging', () => {
    const { code, out } = run('replace');
    expect(code).toBe(1);
    expect(out).toContain('not the partial update it assumes');
    expect(out).toContain('max_rows');
  });

  it('never prints a secret it read from the auth config', () => {
    // The fixture seeds two of the twenty-odd secrets the real GET carries.
    for (const scenario of ['dirty', 'clean', 'replace']) {
      const { out } = run(scenario);
      expect(out).not.toContain('twilio-secret-must-not-print');
      expect(out).not.toContain('captcha-secret-must-not-print');
    }
  });
});
