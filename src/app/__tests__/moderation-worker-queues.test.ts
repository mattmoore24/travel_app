import fs from 'node:fs';
import path from 'node:path';

import { between } from '@/lib/__tests__/source';

/**
 * Every queue a migration opens has to have a worker branch that drains it.
 *
 * This is the fourth time in this project that a capability shipped with
 * nothing on the other end of it: a screen with no entry point, a component
 * mounted nowhere, an option no caller set, and now a moderation queue no
 * worker read. The last one is the worst of the four, because it fails
 * INVISIBLY and in production only: with require_photo_moderation off (how a
 * dev machine runs) the trigger approves immediately and everything looks
 * fine, and with it on (how production runs, LAUNCH_RUNBOOK.md) the photo
 * pins at 'pending' forever, business_detail returns null to every traveler,
 * and moderation_attempts never moves so it does not even fail closed.
 *
 * Source-reading, because what is being checked is that two files agree: a
 * migration creates a door, and the worker walks through it. No runtime test
 * can see that, and the jest suite was fully green over the gap.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const worker = fs.readFileSync(
  path.join(REPO, 'supabase', 'functions', 'moderation-worker', 'index.ts'),
  'utf8'
);
const migrations = path.join(REPO, 'supabase', 'migrations');

/** Every `apply_*_verdict` door any migration has ever opened. */
function verdictDoors(): string[] {
  const found = new Set<string>();
  for (const file of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(migrations, file), 'utf8');
    for (const m of sql.matchAll(/create (?:or replace )?function public\.(apply_\w*verdict)\(/g)) {
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

describe('every verdict door has a worker behind it', () => {
  it('finds the doors at all', () => {
    expect(verdictDoors().length).toBeGreaterThan(4);
  });

  it('is called by the worker, for every one of them', () => {
    // A door with no caller is a queue that fills and never drains. If this
    // fails, either add the branch or drop the door — do not allowlist it.
    const orphaned = verdictDoors().filter((fn) => !worker.includes(fn));
    expect(orphaned).toEqual([]);
  });

  it('drains post photos specifically, which is the one that was missed', () => {
    expect(worker).toContain("from('business_posts')");
    expect(worker).toContain("eq('photo_status', 'pending')");
    expect(worker).toContain('apply_business_post_photo_verdict');
    // And counts its attempts, or a photo the model keeps refusing spins
    // forever instead of failing closed.
    expect(worker).toContain('note_business_post_photo_attempt');
  });

  it('drains group photos, the door 20260903050000 opened', () => {
    // A group's own picture is a column on `groups`, not a messages row, so
    // no other queue can reach it. The door and the counter are both named
    // by the branch, and the failsafe walks through the same door with the
    // engine that says so - without it a photo the model keeps refusing
    // would sit at 'pending' behind "Checking this photo" for ever.
    // Cut by anchors that have to exist: `between` throws on a missing one
    // rather than answering the empty string every assertion passes against.
    const branch = between(worker, "from('groups')", '// -- 4. Pending selfie verifications');
    expect(branch).toContain("eq('photo_status', 'pending')");
    expect(branch).toContain("signedUrl('chat-photos'");
    expect(branch).toContain('apply_group_photo_verdict');
    expect(branch).toContain('note_group_photo_attempt');
    expect(branch).toContain('attempts >= MAX_ATTEMPTS');
    expect(branch).toContain("engine: 'failsafe'");
  });
});

/**
 * And every queue has to be reachable, which is a different thing from
 * existing.
 *
 * The nine queues run in sequence inside one HTTP request and every item is
 * a model call. Nothing bounded how long that took, so a slow queue starved
 * every queue behind it — and starved them for ever, because past the
 * platform's wall clock the isolate is killed mid-item, the `note_*_attempt`
 * write never runs, `moderation_attempts` does not move, and the next tick
 * starts again from the same first row. Held content then never moves while
 * `functions deploy` succeeds, the deploy's probe answers 401, and this
 * suite is green.
 *
 * Source-reading for the same reason as above: what is being checked is that
 * a loop and a clock agree, and no runtime test of this repo runs the worker.
 */
describe('no queue can eat the tick', () => {
  /** `for (const x of y ?? []) {` — one per queue, and nothing else matches. */
  const QUEUE_LOOP = /for \(const \w+ of \w+ \?\? \[\]\) \{\n(\s*)(.*)\n/g;

  it('finds all nine queue loops', () => {
    expect([...worker.matchAll(QUEUE_LOOP)]).toHaveLength(9);
  });

  it('asks for time before every item, in every one of them', () => {
    const unguarded = [...worker.matchAll(QUEUE_LOOP)]
      .filter((m) => !m[2].startsWith('if (!hasTime'))
      .map((m) => m[0].split('\n')[0]);
    expect(unguarded).toEqual([]);
  });

  it('gives every queue a slice, and the slices fit inside the tick', () => {
    const tick = Number(
      /const TICK_BUDGET_MS = ([\d_]+);/.exec(worker)?.[1].replace(/_/g, '') ?? '0'
    );
    const block = /const QUEUE_BUDGET_MS = \{([^}]*)\}/s.exec(worker)?.[1] ?? '';
    const slices = [...block.matchAll(/(\w+): ([\d_]+),/g)].map((m) => ({
      queue: m[1],
      ms: Number(m[2].replace(/_/g, '')),
    }));

    expect(tick).toBeGreaterThan(0);
    expect(slices).toHaveLength(9);
    expect(slices.filter((s) => s.ms <= 0)).toEqual([]);
    // The invariant that makes "reached" true rather than likely: the worst a
    // queue can do to the one behind it is spend its own slice. Raise the tick
    // budget before adding a queue, never the sum past it.
    expect(slices.reduce((total, s) => total + s.ms, 0)).toBeLessThanOrEqual(tick);
  });

  it('bounds a single request, because the SDK default is ten minutes', () => {
    // A hung call is how the isolate gets killed mid-item, and an item killed
    // that way is never even counted as attempted.
    expect(worker).toMatch(/timeout: REQUEST_TIMEOUT_MS/);
    expect(worker).toMatch(/maxRetries: REQUEST_RETRIES/);
    const timeout = Number(
      /const REQUEST_TIMEOUT_MS = ([\d_]+);/.exec(worker)?.[1].replace(/_/g, '') ?? '0'
    );
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(120_000);
  });
});

/**
 * A Supabase function is bundled at DEPLOY time. A floating specifier
 * therefore means a deploy that changes nothing in the repo can still change
 * what production runs, and the first anybody hears of it is content that
 * stops moving.
 */
describe('the edge functions pin what they import', () => {
  const functions = path.join(REPO, 'supabase', 'functions');

  function everyImport(): { file: string; specifier: string }[] {
    const found: { file: string; specifier: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf8');
          for (const m of src.matchAll(/from '((?:npm|jsr):[^']+)'/g)) {
            found.push({ file: path.relative(REPO, full), specifier: m[1] });
          }
        }
      }
    };
    walk(functions);
    return found;
  }

  it('finds the imports at all', () => {
    expect(everyImport().length).toBeGreaterThan(4);
  });

  it('names an exact version on every npm specifier', () => {
    // jsr: is deliberately excluded — see the note on the import itself.
    const floating = everyImport()
      .filter(({ specifier }) => specifier.startsWith('npm:'))
      .filter(({ specifier }) => !/@\d+\.\d+\.\d+(\/|$)/.test(specifier));
    expect(floating).toEqual([]);
  });
});
