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
  immediate_danger: true,
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

  it('lets somebody say another traveler is in danger, and says it first', () => {
    // The chip order is the triage order the reporter reads, and the two
    // urgent reasons lead it: a form that lists "Spam" above "Somebody here
    // is in danger" has said something about how seriously it takes the
    // second one.
    expect(REASON_OPTIONS[0]).toEqual({
      value: 'immediate_danger',
      label: 'Somebody here is in danger',
    });
    expect(REASON_OPTIONS[1]?.value).toBe('underage');
  });

  it('keeps the union in step with the migrations that widened the enum', () => {
    const sql = migrationText();
    for (const reason of EVERY_REASON) {
      // Either the value is in the original create type, or a later
      // migration added it. Both spellings appear as a quoted literal.
      expect(sql).toContain(`'${reason}'`);
    }
    expect(sql).toContain("alter type public.report_reason add value if not exists 'underage'");
    expect(sql).toContain(
      "alter type public.report_reason add value if not exists 'immediate_danger'"
    );
  });

  it('sorts an urgent report to the front rather than suppressing anybody (D34)', () => {
    const sql = migrationText();
    expect(sql).toContain(
      "order by (r.reason::text in ('underage', 'immediate_danger')) desc, r.created_at"
    );
    // No auto-suppression: nothing in the migrations may set a user's status
    // from the reason alone.
    expect(sql).not.toMatch(/set status = 'shadowbanned'[\s\S]{0,200}underage/);
    expect(sql).not.toMatch(/set status = 'shadowbanned'[\s\S]{0,200}immediate_danger/);
  });

  it('adds the two urgent labels in their own migrations, never merged', () => {
    // Postgres refuses to USE a new enum label in the transaction that added
    // it, so a merged file fails the deploy AFTER the label has landed and
    // leaves the database half migrated. The proof is structural: the file
    // that adds a label must not also name it anywhere else.
    for (const [file, label] of [
      ['20260831200000_a_report_can_say_underage.sql', 'underage'],
      ['20260901120000_a_report_can_say_danger.sql', 'immediate_danger'],
    ]) {
      const body = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
      const statements = body
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
      expect(statements.match(new RegExp(`'${label}'`, 'g'))).toHaveLength(1);
    }
  });
});
