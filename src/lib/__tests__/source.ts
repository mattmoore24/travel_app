import fs from 'node:fs';
import path from 'node:path';

/**
 * Reading source and asserting on a slice of it, without the slice being
 * allowed to quietly become nothing.
 *
 * A large number of the checks in this repo are of the form "this block of
 * that file does not do X" — the folded first message never writes, the memo
 * never reads the clock, the appeal branch never renders a second contact
 * form. There is no runtime test for those: what is being asserted is the
 * ABSENCE of something, and absence is only observable in the text. So the
 * block is cut out of the file by two anchors and a negative assertion is
 * made about it.
 *
 * The cut is where it goes wrong, and it goes wrong SILENTLY, which is the
 * whole problem:
 *
 * - `code.slice(code.indexOf(a), code.indexOf(b))` when `a` is no longer in
 *   the file. indexOf answers -1, slice reads that as "one character from
 *   the end", the end anchor is somewhere in the middle, and the result is
 *   `''`. `expect('').not.toMatch(anything)` passes.
 * - The same expression when `b` happens to occur BEFORE `a`. `useEffect(`
 *   appears on line 100 and the memo being cut out starts on line 403, so
 *   the range is inverted and the result is `''` again.
 *
 * This repo has shipped both. The first was introduced by a fix round that
 * added a branch in front of the anchor it was cut by, turning
 * `{mutedBy != null ? (` into `) : mutedBy != null ? (`; the assertion under
 * it — that nothing on the folded path writes, calls an RPC, or tells the
 * sender — went on passing against an empty string. The second sat in
 * business-home.test.ts from the day it was written.
 *
 * `between` makes both of those a failing test instead of an empty one: a
 * missing anchor throws, and the closing anchor is searched for AFTER the
 * opening one, so an inverted pair cannot silently produce an empty range
 * either. Prefer it over a hand-rolled `slice(indexOf(...))` anywhere the
 * assertion that follows is a negative one.
 */

/** The repo root, from this file's home in `src/lib/__tests__`. */
const REPO = path.join(__dirname, '..', '..', '..');

/** Read a file by its repo-relative path, e.g. `src/app/_layout.tsx`. */
export function source(file: string): string {
  return fs.readFileSync(path.join(REPO, file), 'utf8');
}

/**
 * The text from `from` up to the next `to` after it.
 *
 * Throws — which is a failing test, with the anchor printed — when either
 * anchor is missing, rather than answering an empty string that every
 * negative assertion passes against.
 */
export function between(code: string, from: string, to: string): string {
  const start = code.indexOf(from);
  if (start < 0) {
    throw new Error(`source anchor not found: ${JSON.stringify(from)}`);
  }
  const end = code.indexOf(to, start + from.length);
  if (end < 0) {
    throw new Error(`closing anchor ${JSON.stringify(to)} not found after ${JSON.stringify(from)}`);
  }
  return code.slice(start, end);
}

/**
 * The text from `from` to the end of the file, for the cases where the block
 * being cut out runs to the bottom. Same contract: a missing anchor throws.
 */
export function after(code: string, from: string): string {
  const start = code.indexOf(from);
  if (start < 0) {
    throw new Error(`source anchor not found: ${JSON.stringify(from)}`);
  }
  return code.slice(start);
}
