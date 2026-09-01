import fs from 'node:fs';

import { repoPath, sourceFiles, withoutComments } from '../source-scan';

/**
 * Two characters the app may never SHOW a person, and one place to say so.
 *
 * **Curly quotes** (U+2018/2019/201C/201D). Not a typographic preference: the
 * app's strings are ASCII everywhere else, so the two that were not read as
 * pasted in from another document — and both of them were on legal-adjacent
 * surfaces, the house rules and the map filters, which are exactly the
 * screens where "written elsewhere, dropped in here" is the wrong impression
 * to give.
 *
 * **Em dashes** (U+2014). The design brief bans them in anything the app
 * shows, as the loudest of the AI tells. The repo already asserts this
 * feature by feature — `src/features/chat/__tests__/closed-notice.test.ts:25`,
 * `src/features/profile/__tests__/completion.test.ts:89` and a dozen more —
 * and `src/app/__tests__/copy-lint.test.ts` does it for the copy the DATABASE
 * ships. Every one of those covers the strings somebody remembered to cover.
 * This covers the rest.
 *
 * Comments are blanked before scanning, and that is the whole reason this can
 * be a hard gate: the em dash is right in prose, and this file, the traps
 * skill and most of `src/` use it freely one line above a string that may not.
 *
 * `__tests__` is excluded for the same reason: a test title quotes what it
 * forbids, and `src/features/pins/__tests__/filters.test.ts:104` ("accepts
 * either clock's idea of the day") should not have to write worse English to
 * satisfy a scan about shipped copy.
 *
 * JSX text is caught as well as string literals, deliberately. `<Text>Don't
 * worry</Text>` is copy by any definition, and scanning the stripped source
 * rather than parsing out literals is both simpler and stricter.
 */

const BANNED: { char: string; name: string; instead: string }[] = [
  { char: '‘', name: 'U+2018 left single quote', instead: "a straight ' " },
  { char: '’', name: 'U+2019 right single quote', instead: "a straight '" },
  { char: '“', name: 'U+201C left double quote', instead: 'a straight "' },
  { char: '”', name: 'U+201D right double quote', instead: 'a straight "' },
  {
    char: '—',
    name: 'U+2014 em dash',
    instead: 'a full stop, a comma, or two sentences (design-review: em dashes are banned in copy)',
  },
];

/**
 * Strings that must keep a banned character, each with the reason it is not
 * copy. A `snippet` rather than a line number, so the entry survives the file
 * being reformatted; `keeps its allowlist honest` below fails if one stops
 * matching anything, which is how a stale exemption gets noticed.
 *
 * There is no blanket ignore here on purpose. Anything added must be a string
 * NO PERSON READS — a key, a token, a value that has to equal something
 * outside this repo character for character.
 */
const ALLOWED: { file: string; snippet: string; why: string }[] = [
  {
    file: 'src/lib/failure-message.ts',
    snippet: "'sending too fast — wait a moment': HINT_COPY.message_throttle",
    why:
      'A lookup KEY, not copy. It is the exact lowercase fragment a deployed Postgres function ' +
      'raises, and the map exists to replace it with a written sentence before anybody sees it. ' +
      'Changing the dash here would break the match and ship the fragment instead. Delete this ' +
      'entry when no live migration raises that wording any more.',
  },
];

type Finding = { key: string; message: string; line: string };

function scan(file: string): Finding[] {
  const code = withoutComments(fs.readFileSync(file, 'utf8'));
  const where = repoPath(file);
  const findings: Finding[] = [];
  code.split('\n').forEach((line, index) => {
    for (const banned of BANNED) {
      if (!line.includes(banned.char)) continue;
      const key = `${where}:${index + 1}`;
      findings.push({
        key,
        line,
        message: `${key}: ${banned.name} in a string the app shows. Use ${banned.instead}. If this is not copy, add it to ALLOWED in scripts/__tests__/shipped-punctuation.test.ts with the reason. If it is a comment, this scan cannot see comments, so it is a trailing one: move it to its own line.`,
      });
    }
  });
  return findings;
}

const isAllowed = (finding: Finding): boolean =>
  ALLOWED.some(
    (entry) => finding.key.startsWith(`${entry.file}:`) && finding.line.includes(entry.snippet)
  );

describe('the punctuation the app shows', () => {
  const files = sourceFiles();
  const findings = () => files.flatMap(scan);

  it('finds the source to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('carries no curly quote and no em dash outside the allowlist', () => {
    expect(
      findings()
        .filter((finding) => !isAllowed(finding))
        .map((f) => f.message)
    ).toEqual([]);
  });

  it('keeps its allowlist honest: every entry still matches a real string', () => {
    const live = findings();
    const stale = ALLOWED.filter(
      (entry) =>
        !live.some(
          (finding) =>
            finding.key.startsWith(`${entry.file}:`) && finding.line.includes(entry.snippet)
        )
    ).map((entry) => `${entry.file}: nothing matches ${JSON.stringify(entry.snippet)} any more`);
    expect(stale).toEqual([]);
  });
});
