import fs from 'node:fs';
import path from 'node:path';

import { after, between } from '@/lib/__tests__/source';

/**
 * No test in this repo cuts a block out of a source file with a raw
 * `indexOf` as the start offset, because that cut fails silently.
 *
 * `code.slice(code.indexOf(a), code.indexOf(b))` answers `''` in two ways
 * that nothing prints: `a` is not in the file any more (indexOf gives -1,
 * which slice reads as one character from the end, and the end anchor is
 * before that), or `b` occurs earlier in the file than `a`. Every negative
 * assertion passes against `''`, so the check goes on being green while
 * checking nothing.
 *
 * This repo shipped one of each. `muted-words-reach.test.ts` asserted that
 * the folded first message never writes, never calls an RPC and never tells
 * the sender — the one invariant that feature may not break — against an
 * empty string, because a fix round put `{checkingList ? (` in front of the
 * anchor it was cut by. `business-home.test.ts` cut its memo from
 * `const chatsThisWeek` (line 403) to `useEffect(` (line 100) and had been
 * asserting about nothing since the day it was written.
 *
 * `between` and `after` in `./source.ts` make both of those a failing test:
 * a missing anchor throws with the anchor printed, and the closing anchor is
 * searched for AFTER the opening one so an inverted pair cannot collapse. So
 * the rule is mechanical, and this is where it is enforced.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const SELF = 'src/lib/__tests__/source-anchors.test.ts';

function testFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : testFiles(full);
    }
    return /\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The first argument of the call whose `(` is at `open`, or null if the
 * parentheses never balance. String bodies are stepped over so a `(` or a
 * comma inside an anchor literal does not end the argument early.
 */
function firstArgument(code: string, open: number): string | null {
  let depth = 0;
  let arg = '';
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      arg += c;
      for (i++; i < code.length; i++) {
        arg += code[i];
        if (code[i] === '\\') {
          arg += code[++i] ?? '';
        } else if (code[i] === quote) {
          break;
        }
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      if (depth === 1) {
        continue;
      }
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        return arg;
      }
    } else if (c === ',' && depth === 1) {
      return arg;
    }
    arg += c;
  }
  return null;
}

describe('source slices are cut by an anchor that has to exist', () => {
  // This file is skipped because it quotes the very shape it forbids, in
  // its own prose and in the unit tests below. Nothing else is exempt.
  const files = [...testFiles(path.join(REPO, 'src')), ...testFiles(path.join(REPO, 'scripts'))]
    .map((file) => path.relative(REPO, file))
    .filter((file) => file !== SELF);

  it('finds the test files to police', () => {
    // A walk that quietly finds nothing passes the assertion below it, which
    // is the same defect this whole file is about.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('src/features/profile/__tests__/muted-words-reach.test.ts');
  });

  it('and none of them starts a slice at an indexOf', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = fs.readFileSync(path.join(REPO, file), 'utf8');
      for (let at = code.indexOf('.slice('); at >= 0; at = code.indexOf('.slice(', at + 1)) {
        const arg = firstArgument(code, at + 6);
        if (arg != null && arg.includes('indexOf(')) {
          offenders.push(`${file}:${code.slice(0, at).split('\n').length}`);
        }
      }
    }
    // Use `between(code, from, to)` or `after(code, from)` from
    // src/lib/__tests__/source.ts instead: they throw on an anchor that has
    // stopped matching, where a slice answers '' and passes.
    expect(offenders).toEqual([]);
  });
});

describe('the helper that replaces it', () => {
  const code = 'alpha\nBEGIN\nmiddle\nEND\nomega\n';

  it('cuts the block the anchors name', () => {
    expect(between(code, 'BEGIN', 'END')).toBe('BEGIN\nmiddle\n');
    expect(after(code, 'END')).toBe('END\nomega\n');
  });

  it('throws on an anchor that has stopped matching, rather than answering nothing', () => {
    expect(() => between(code, 'GONE', 'END')).toThrow('source anchor not found: "GONE"');
    expect(() => between(code, 'BEGIN', 'GONE')).toThrow('closing anchor "GONE" not found');
    expect(() => after(code, 'GONE')).toThrow('source anchor not found: "GONE"');
  });

  it('cannot be inverted into an empty answer by an end anchor that comes first', () => {
    // The business-home shape: the closing anchor also occurs above the
    // opening one. A raw slice would answer '' here.
    const inverted = 'END\nalpha\nBEGIN\nmiddle\nEND\n';
    expect(inverted.slice(inverted.indexOf('BEGIN'), inverted.indexOf('END'))).toBe('');
    expect(between(inverted, 'BEGIN', 'END')).toBe('BEGIN\nmiddle\n');
  });
});
