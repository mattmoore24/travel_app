import fs from 'node:fs';
import path from 'node:path';

import { after } from '@/lib/__tests__/source';

/**
 * The database ships user-facing copy: push titles and bodies land on lock
 * screens, raised exceptions reach the user verbatim through the Alert in
 * src/lib/query-client.ts, and curated pin notes are the map's voice on day
 * one. The design brief bans em dashes and the dating-frame vocabulary in
 * anything the app shows — and 20260821120000_moderation_copy.sql proved a
 * copy pass done by hand misses functions (it redefined two of the three that
 * carried the banned sentence). This gate is why the next pass cannot.
 *
 * Rules, scoped so the gate never fires on a comment (or it would be turned
 * off within a week):
 *   1. No U+2014 inside any single-quoted SQL literal in supabase/migrations
 *      or supabase/seed, except the payload of a `comment on` statement.
 *   2. No banned word (swipe, deck, match, unmatch, request) inside a literal that is
 *      part of a push_queue statement — that is lock-screen copy. Bare
 *      machine tokens (e.g. the 'request' in jsonb_build_object('type',
 *      'request')) are exempt: they are payload keys, not copy.
 *   3. No banned word inside a `raise exception` literal — raised messages
 *      are user copy via the query-client Alert.
 *
 * Historical strings a later migration has already replaced live in
 * supabase/migrations/.copy-lint-allow (file:line). The gate polices new
 * work; nobody rewrites migration history to satisfy it.
 */

const ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const SEED = path.join(ROOT, 'supabase', 'seed');

const EM_DASH = '—';
// `unmatch` spelled out: \bmatch\b cannot see inside it (no boundary after
// the n), which let 'cannot unmatch a closed conversation' ship unflagged.
const BANNED = /\b(swipe|deck|match|unmatch(?:ed)?|request)\b/i;
const MACHINE_TOKEN = /^[a-z_]+$/;

const sqlFiles = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((f) => path.join(dir, f))
    : [];

/** Blank out comments while preserving every character position. */
function stripComments(src: string): string {
  // /* ... */ blocks, newlines kept so line numbers stay true.
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return s
    .split('\n')
    .map((line) => {
      let out = '';
      let inString = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inString) {
          if (c === "'" && line[i + 1] === "'") {
            out += "''";
            i++;
            continue;
          }
          if (c === "'") inString = false;
          out += c;
        } else if (c === "'") {
          inString = true;
          out += c;
        } else if (c === '-' && line[i + 1] === '-') {
          break; // comment to end of line
        } else {
          out += c;
        }
      }
      return out;
    })
    .join('\n');
}

type Finding = { key: string; message: string };

function lintFile(filePath: string): Finding[] {
  const base = path.basename(filePath);
  const src = stripComments(fs.readFileSync(filePath, 'utf8'));
  const findings: Finding[] = [];
  const literal = /'((?:[^']|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = literal.exec(src)) !== null) {
    const content = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    const key = `${base}:${line}`;
    const stmt = src.slice(src.lastIndexOf(';', m.index) + 1, m.index);
    if (/^\s*comment\s+on/i.test(stmt)) continue;

    if (content.includes(EM_DASH)) {
      findings.push({ key, message: `${key}: em dash in literal ${JSON.stringify(content)}` });
    }

    const banned = BANNED.exec(content);
    if (!banned) continue;
    const inPush = /push_queue/i.test(stmt);
    const inRaise = /raise\s+exception\s*$/i.test(src.slice(Math.max(0, m.index - 60), m.index));
    if (inPush && MACHINE_TOKEN.test(content)) continue; // payload token, not copy
    if (inPush || inRaise) {
      findings.push({
        key,
        message: `${key}: banned word "${banned[0]}" in ${inPush ? 'push' : 'raise'} literal ${JSON.stringify(content)}`,
      });
    }
  }
  return findings;
}

const allowlist = (): Set<string> => {
  const file = path.join(MIGRATIONS, '.copy-lint-allow');
  if (!fs.existsSync(file)) return new Set();
  return new Set(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
  );
};

describe('the copy the database ships', () => {
  const allowed = allowlist();
  const files = [...sqlFiles(MIGRATIONS), ...sqlFiles(SEED)];

  it('finds the SQL to lint', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('carries no em dash and no banned word outside the historical allowlist', () => {
    const violations = files
      .flatMap(lintFile)
      .filter((f) => !allowed.has(f.key))
      .map((f) => f.message);
    expect(violations).toEqual([]);
  });

  it('keeps the allowlist honest: every entry still matches a real finding', () => {
    const found = new Set(files.flatMap(lintFile).map((f) => f.key));
    const stale = [...allowed].filter((key) => !found.has(key));
    expect(stale).toEqual([]);
  });
});

/**
 * The App Store listing is copy too, and it is the surface most likely to
 * import the dating frame by accident: it gets written last, under a
 * deadline, from references that are all dating apps. So the draft in
 * docs/APP_STORE.md is scanned by the same rules the app's own strings obey.
 *
 * Scoped to the marked block, because the rest of that document is internal
 * prose about builds and certificates, where an em dash is nobody's problem
 * and "request" means an HTTP one.
 */

/**
 * How much of the description is above the More fold, in characters.
 *
 * App Store Connect folds by RENDERED lines on the reader's own screen
 * width, so a source-line count proves nothing about what they see. A
 * character prefix is the property that survives being re-wrapped.
 */
const FOLD = 120;

/**
 * Listing-only vocabulary, each phrase rather than each word.
 *
 * The design brief's bans are about MEANING, and the words carry innocent
 * meanings elsewhere: 'place' is right for a spot on the map (the drop-a-pin
 * search field) and appears inside 'placement', so a bare \bplace\b in
 * BANNED would fire on copy that is correct. These are the exact phrases the
 * listing got wrong, kept as phrases for that reason.
 */
const LISTING_BANNED: { pattern: RegExp; why: string }[] = [
  {
    pattern: /\bplaces you go\b/i,
    why: '"place" meaning a business. A hostel, bar, cafe or tour operator is a BUSINESS in every string anybody reads (founder, 2026-08-28).',
  },
  {
    pattern: /\branked\b|\bscored\b|\bflicked\b/i,
    why: 'the travelers queue described as a ranking or a card stack, which imports the frame even in the negative. Say the mechanic positively: one person at a time, read in full, say hello or move on.',
  },
];
describe('the App Store listing copy', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'APP_STORE.md'), 'utf8');
  const START = '<!-- listing-copy:start -->';
  const END = '<!-- listing-copy:end -->';

  const section = (): string => {
    const from = doc.indexOf(START);
    const to = doc.indexOf(END);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return doc.slice(from + START.length, to);
  };

  /** Every fenced block in the listing section, contents only. */
  const fencedBlocks = (): string[] =>
    [...section().matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());

  it('is present and substantial', () => {
    expect(section().trim().length).toBeGreaterThan(500);
  });

  it('carries no em dash', () => {
    expect(section().includes(EM_DASH)).toBe(false);
  });

  it('carries no banned word', () => {
    const offending = section()
      .split('\n')
      .filter((line) => BANNED.test(line));
    expect(offending).toEqual([]);
  });

  it('spends its opening characters on the map, the shared dates and the word platonic', () => {
    // App Store Connect folds the description by RENDERED lines, and it
    // renders whatever width the reader's phone is - so counting SOURCE
    // lines certified nothing. The property that survives the fold is a
    // character prefix: whatever the device wraps at, the first ~120
    // characters are above More.
    const description = after(section(), 'A map of what other travelers');
    const opening = description.slice(0, FOLD).toLowerCase();
    expect(opening).toContain('map');
    expect(opening).toContain('platonic');
    expect(opening).toMatch(/overlap|same dates|shared dates|days you share/);
  });

  it('keeps every pasted paragraph on one physical line', () => {
    // These blocks are pasted verbatim and App Store Connect keeps every
    // newline it is given, so an 80-column hard wrap becomes a line break in
    // the middle of a sentence on the store page. A line that is followed by
    // one starting in lower case is that wrap, and nothing else: every real
    // line in these blocks opens with a capital.
    const wrapped: string[] = [];
    for (const block of fencedBlocks()) {
      const lines = block.split('\n');
      lines.forEach((line, i) => {
        const next = lines[i + 1];
        if (line.trim() !== '' && next != null && /^[a-z]/.test(next)) {
          wrapped.push(`${line} / ${next}`);
        }
      });
    }
    expect(wrapped).toEqual([]);
  });

  it('carries none of the vocabulary the SQL scan cannot see', () => {
    const offending = LISTING_BANNED.filter((rule) => rule.pattern.test(section())).map(
      (rule) => rule.why
    );
    expect(offending).toEqual([]);
  });

  it('keeps the name, subtitle and keyword fields inside the App Store limits', () => {
    const [name, subtitle, keywords] = fencedBlocks().map((block) => block.trim());
    expect(name.length).toBeLessThanOrEqual(30);
    expect(subtitle.length).toBeLessThanOrEqual(30);
    expect(keywords.length).toBeLessThanOrEqual(100);
    // A keyword field with a space after a comma spends a character on
    // nothing: Apple splits on the comma either way.
    expect(keywords).not.toMatch(/, /);
  });
});
