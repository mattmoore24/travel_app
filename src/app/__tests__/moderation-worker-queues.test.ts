import fs from 'node:fs';
import path from 'node:path';

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
});
