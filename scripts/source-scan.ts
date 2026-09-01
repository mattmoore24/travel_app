import fs from 'node:fs';
import path from 'node:path';

/**
 * The machinery the source scans in `scripts/__tests__` share.
 *
 * A source scan is this project's answer to a rule that no type, no test and
 * no screenshot can hold: "never call this API", "never ship this character".
 * `src/lib/live-camera.ts` and its scan
 * (`src/lib/__tests__/live-camera.test.ts:108-141`) are the pattern — a rule
 * written out in prose at the place it is enforced, and a scan that fails the
 * build the moment somebody writes the thing the prose says not to.
 *
 * Two properties matter more than coverage, and both are here because a scan
 * that gets them wrong is switched off within a week:
 *
 * 1. **Comments survive the strip.** The sentence saying "never this" is the
 *    cheapest place to learn a rule, so every scan reads code with the
 *    comments blanked out. Blanked, not deleted: the blanks keep every line
 *    number and column true, so a failure names the line a person can open.
 * 2. **The scan is exact rather than broad.** Each one below carries a small,
 *    explicit list of what is allowed and why, instead of a regex over the
 *    whole tree that will one day fire on innocent code.
 */

/** The repository root, from `scripts/`. */
export const ROOT = path.join(__dirname, '..');

export const SRC = path.join(ROOT, 'src');

/**
 * Every TypeScript file under `src/`.
 *
 * Tests are excluded by default and that exclusion is load-bearing rather
 * than lazy: a test's own title legitimately quotes the thing it forbids
 * (`src/features/pins/__tests__/filters.test.ts` uses a curly apostrophe in
 * "accepts either clock's idea of the day"), and a scan that fired on those
 * would be teaching people to write worse test names.
 */
export function sourceFiles({ includeTests = false } = {}): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (includeTests || entry.name !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

/** `src/lib/query-client.ts` — what a failure message should print. */
export function repoPath(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/**
 * The source with every comment replaced by spaces.
 *
 * Blanking rather than deleting keeps line numbers and columns true, which is
 * what lets a finding say `src/constants/policies.ts:35` and have that be the
 * line somebody opens. `src/app/__tests__/copy-lint.test.ts` does the same
 * for SQL, for the same reason.
 *
 * Trailing comments are stripped too, but only when the quoting on the line
 * is unambiguous: `//` inside a string literal is not a comment, and neither
 * is the one in `https://`. When the quote counts are odd (a template literal
 * spanning lines, most often) the line is left alone. That direction is the
 * safe one to be wrong in for a `//` that IS code, and the only cost of being
 * wrong the other way is that a trailing comment gets scanned — which is why
 * a rule worth learning belongs on its own line.
 */
export function withoutComments(source: string): string {
  const blocksBlanked = source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' ')
  );
  return blocksBlanked
    .split('\n')
    .map((line) => {
      const whole = /^(\s*)\/\//.exec(line);
      if (whole) return line.replace(/\S/g, ' ');
      const at = findTrailingComment(line);
      return at < 0 ? line : line.slice(0, at) + ' '.repeat(line.length - at);
    })
    .join('\n');
}

/** Index of a trailing `//`, or -1 when there is none we are sure about. */
function findTrailingComment(line: string): number {
  for (let i = 1; i < line.length - 1; i++) {
    if (line[i] !== '/' || line[i + 1] !== '/') continue;
    if (!/\s/.test(line[i - 1])) continue; // `https://`, `a / /b/`
    const before = line.slice(0, i);
    const balanced = ["'", '"', '`'].every(
      (quote) => (before.match(new RegExp(`(?<!\\\\)${quote}`, 'g')) ?? []).length % 2 === 0
    );
    if (balanced) return i;
    return -1;
  }
  return -1;
}

/** 1-based line number of a character offset, for a finding a person can open. */
export function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}
