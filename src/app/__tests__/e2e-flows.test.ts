import fs from 'node:fs';
import path from 'node:path';

/**
 * Every selector the Maestro flows use is one Maestro actually has.
 *
 * Run 81 produced not a single screenshot from either tour. Both carried
 * `tapOn: { accessibilityLabel: ... }`, which is not a Maestro selector — it
 * matches accessibility labels through `text` — and an unknown property is a
 * PARSE error, so each flow died before its first command. Twenty minutes of
 * macOS runner, two tours, nothing to look at, and the whole failure was one
 * line reading "Unknown Property" in the middle of a log, naming no screen.
 *
 * So the same mistake now fails in the gate instead, in under a second, with
 * the file and the line. Deliberately a text scan rather than a YAML parse:
 * neither yaml package is a declared dependency here, and a line number is
 * more use in a failure than a parsed tree would be.
 */
const E2E = path.join(__dirname, '..', '..', '..', 'e2e');

const flowFiles = (): string[] =>
  ['flows', 'subflows'].flatMap((dir) => {
    const full = path.join(E2E, dir);
    return fs.existsSync(full)
      ? fs
          .readdirSync(full)
          .filter((f) => f.endsWith('.yml'))
          .map((f) => path.join(full, f))
      : [];
  });

/**
 * Keys Maestro understands inside a command's object form.
 *
 * Selectors, the modifiers that sit beside them, and the config keys of the
 * commands whose object form is not a selector at all (runFlow, swipe,
 * scrollUntilVisible and friends). One flat set is enough: the point is to
 * catch a key that exists nowhere in Maestro, not to police which command
 * takes which.
 */
const KNOWN = new Set([
  // Selectors and their modifiers.
  'id',
  'text',
  'point',
  'start',
  'end',
  'index',
  'below',
  'above',
  'leftOf',
  'rightOf',
  'containsChild',
  'childOf',
  'enabled',
  'checked',
  'focused',
  'selected',
  'optional',
  'label',
  'retryTapIfNoChange',
  'waitToSettleTimeoutMs',
  'longPress',
  'repeat',
  'delay',
  // Command configuration.
  'when',
  'commands',
  'file',
  'env',
  'visible',
  'notVisible',
  'true',
  'timeout',
  'element',
  'direction',
  'speed',
  'visibilityPercentage',
  'centerElement',
  'appId',
  'clearState',
  'clearKeychain',
  'stopApp',
  'permissions',
  'arguments',
  'from',
  'duration',
  'latitude',
  'longitude',
  'name',
  'script',
  'condition',
]);

describe('the Maestro flows use selectors Maestro has', () => {
  const files = flowFiles();

  it('finds the flows', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [path.basename(f), f] as const))('%s', (_name, file) => {
    const unknown: string[] = [];
    file &&
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // A nested mapping key: indented, a bare word, then a colon. Skips
          // list items ("- tapOn:"), comments, and anything quoted, which is
          // a value rather than a key.
          const match = /^\s+([A-Za-z][A-Za-z0-9_]*):(\s|$)/.exec(line);
          if (match && !KNOWN.has(match[1])) {
            unknown.push(`${path.basename(file)}:${i + 1} ${match[1]}`);
          }
        });
    expect(unknown).toEqual([]);
  });
});
