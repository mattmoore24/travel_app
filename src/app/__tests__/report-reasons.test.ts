import fs from 'node:fs';
import path from 'node:path';

import { REASON_NOT_OFFERED, REASON_OPTIONS } from '@/app/report';
import type { ReportReason } from '@/lib/database.types';

/**
 * Every reason the database accepts is either on the form or explicitly
 * declined in writing.
 *
 * This is the test that would have caught 'impersonation': it was added to
 * public.report_reason on 2026-08-27 and never reached the union in
 * database.types.ts, let alone the form, so for a month the app could not
 * say a thing the database was waiting to hear. 'underage' was the same
 * shape of gap from the other end, and worse, because the privacy policy
 * promised a mechanism that did not exist.
 */

/**
 * Every value the enum carries, as KEYS rather than as a list.
 *
 * A union still cannot be enumerated at runtime, so somebody has to write the
 * values down. The shape is what matters: `const EVERY_REASON: ReportReason[]`
 * type-checks perfectly while MISSING members, because an array annotation
 * only asks that each element belongs to the union, never that the union is
 * covered. So the next value added to `ReportReason` would compile, and both
 * tests below would pass with it in neither list - the exact silent drift
 * this file exists to catch, reproduced in the file itself.
 *
 * `satisfies Record<ReportReason, true>` asks the other question. Every key is
 * required, so widening the union breaks the BUILD here until the value is
 * written down; and excess-property checking refuses a key the union does not
 * carry, so a value deleted from the enum breaks it too. The runtime list is
 * derived from the same object, and cannot drift from it.
 */
const EVERY_REASON_KEYED = {
  flirtation_or_sexual: true,
  harassment: true,
  spam: true,
  fake_profile: true,
  safety_concern: true,
  impersonation: true,
  underage: true,
  other: true,
} satisfies Record<ReportReason, true>;

const EVERY_REASON = Object.keys(EVERY_REASON_KEYED) as ReportReason[];

const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');

const migrationText = (): string =>
  fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .join('\n');

describe('the report reasons', () => {
  it('accounts for every value the enum carries', () => {
    const offered = new Set(REASON_OPTIONS.map((option) => option.value));
    const unaccounted = EVERY_REASON.filter(
      (reason) => !offered.has(reason) && !REASON_NOT_OFFERED[reason]
    );
    expect(unaccounted).toEqual([]);
  });

  it('offers nothing the database would reject', () => {
    const known = new Set<string>(EVERY_REASON);
    expect(REASON_OPTIONS.filter((option) => !known.has(option.value))).toEqual([]);
  });

  it('lets somebody say a traveler is under 18', () => {
    const underage = REASON_OPTIONS.find((option) => option.value === 'underage');
    expect(underage).toBeDefined();
    // Neutral, like the other five. Not an accusation form.
    expect(underage?.label).toBe('They are under 18');
  });

  it('keeps the union in step with the migrations that widened the enum', () => {
    const sql = migrationText();
    for (const reason of EVERY_REASON) {
      // Either the value is in the original create type, or a later
      // migration added it. Both spellings appear as a quoted literal.
      expect(sql).toContain(`'${reason}'`);
    }
    expect(sql).toContain("alter type public.report_reason add value if not exists 'underage'");
  });

  it('sorts an underage report to the front rather than suppressing anybody (D34)', () => {
    const sql = migrationText();
    expect(sql).toContain("order by (r.reason::text = 'underage') desc, r.created_at");
    // No auto-suppression: nothing in the migrations may set a user's status
    // from the reason alone.
    expect(sql).not.toMatch(/set status = 'shadowbanned'[\s\S]{0,200}underage/);
  });
});
