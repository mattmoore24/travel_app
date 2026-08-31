import fs from 'node:fs';
import path from 'node:path';

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
