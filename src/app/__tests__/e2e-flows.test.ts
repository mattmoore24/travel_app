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
  // '.' picks up the flows that live OUTSIDE e2e/flows on purpose (warmup,
  // the AX5 large-text tour) — outside so the workflow's flow-loop glob
  // cannot run them as ordinary passes, but they are still Maestro files
  // and a parse error in one is still a silent no-op on the runner.
  ['flows', 'subflows', '.'].flatMap((dir) => {
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

/**
 * Commands this suite has watched fail and will not have back.
 *
 * `hideKeyboard` took run 82 down in both tours — the same "no reliable
 * dismiss path" that signed-in-tour.yml had already written down in a comment
 * and that nobody read before reaching for it again. Every place it was used,
 * nothing needed dismissing: the next target was a docked button. Where a
 * keyboard genuinely has to go away, a single-line field takes `pressKey:
 * Enter`, which iOS honours by blurring.
 */
const BANNED: Record<string, string> = {
  hideKeyboard:
    'no reliable dismiss path on this Maestro/iOS pair; it failed run 82 in both tours. ' +
    'Use pressKey: Enter on a single-line field, or nothing at all when the next target is docked.',
};

describe('the flows do not reach for commands that have failed here', () => {
  it.each(flowFiles().map((f) => [path.basename(f), f] as const))('%s', (_name, file) => {
    const offenders: string[] = [];
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // The command itself, not a mention of it in a comment.
        const match = /^\s*-\s+([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(line);
        if (match && BANNED[match[1]]) {
          offenders.push(`${path.basename(file)}:${i + 1} ${match[1]} — ${BANNED[match[1]]}`);
        }
      });
    expect(offenders).toEqual([]);
  });
});

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

/**
 * A docked button is not reachable while the keyboard is up.
 *
 * Since 326837d the StepScreen/StepShell footer is a sibling BELOW the
 * keyboard floor, not inside it — the founder asked for exactly that: the
 * button does not rise, the keyboard covers it. Maestro does not know that.
 * The button is still in the accessibility tree with a frame, so `tapOn`
 * reports SUCCESS and puts the tap through the keyboard, and the flow dies
 * several steps later on an assertion about something the button never did.
 * That is runs 126 and 127: `tapOn: 'Send'` in the say-hi composer, then
 * twenty-five seconds waiting for a confirmation, with the composer still
 * open and the typed line still in the box in Maestro's own screenshot.
 *
 * So: if a flow types into a field on one of these screens, it must put the
 * keyboard away before it taps that same screen's footer button. Every field
 * carries a Hide keyboard bar and that bar is the way back down.
 *
 * Scoped per screen, which is what makes it safe: the chat room's Composer
 * has a 'Send' too, inline in the bar, and it is SUPPOSED to ride up with the
 * keyboard. Its screen carries neither marker below, so its ids and its label
 * are not in this map and its taps are never matched.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered. A
 * label that is computed (`{editing ? 'Save it' : 'Put it up'}`) is not
 * collected, only literal `continueLabel="…"` and `<PrimaryButton label="…"`.
 * A `runFlow` clears the state, because this scan does not follow a subflow
 * and guessing what is inside one would be worse than admitting it. Both are
 * gaps that let a real offence through; neither invents one. It catches the
 * shape that has actually cost runs.
 */
const SRC = path.join(__dirname, '..', '..');

const tsxFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : tsxFiles(full);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [full] : [];
  });

/**
 * Screens whose primary button is docked under the keyboard: ids → labels.
 *
 * Two shapes, both from the same founder ask on 2026-09-05. A StepScreen or
 * StepShell puts its footer BELOW the keyboard floor. A Sheet passed a
 * `keyboardAllowance` lifts by only the part of the keyboard that reaches past
 * whatever is pinned under its scroller, which leaves that pinned thing
 * covered too — the pin form is the one that has it.
 */
const dockedScreens = (): { file: string; ids: string[]; labels: string[] }[] =>
  tsxFiles(SRC)
    .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
    .map(({ file, source }) => ({
      file,
      source,
      shell: /<Step(Screen|Shell)\b/.test(source),
      // A sheet docks its buttons under the keyboard EITHER by passing an
      // explicit keyboardAllowance (the pin form, which owns its own scroll
      // frame) OR by handing Sheet a `footer` alongside avoidKeyboard, which
      // Sheet now measures for itself. Without the second arm, trip-editor
      // and profile-me — whose docked buttons are "Save changes" and "Delete
      // forever" — drop out of this guard the moment Sheet stops needing an
      // allowance from them, and every flow tapping through their keyboard
      // goes unwatched.
      sheet:
        /keyboardAllowance/.test(source) ||
        (/avoidKeyboard/.test(source) && /footer=\{/.test(source)),
    }))
    .filter(({ shell, sheet }) => shell || sheet)
    .map(({ file, source, shell }) => ({
      file: path.relative(SRC, file),
      ids: [...source.matchAll(/\b(?:input)?[Tt]estID="([^"]+)"/g)].map((m) => m[1]),
      labels: [
        ...[...source.matchAll(/\bcontinueLabel="([^"]+)"/g)].map((m) => m[1]),
        // A sheet pins its own PrimaryButton rather than passing a label down.
        // `\b[^>]*?` rather than `\s+`, because a pinned button often carries
        // `variant` or `testID` before its label and the tighter pattern read
        // straight past those — profile-me's "Delete forever" is one.
        ...[...source.matchAll(/<PrimaryButton\b[^>]*?\slabel="([^"]+)"/g)].map((m) => m[1]),
        // The prop's own default, for a shell that does not pass one.
        ...(shell ? ['Continue'] : []),
      ],
    }))
    .filter(({ ids, labels }) => ids.length > 0 && labels.length > 0);

/** What a `- tapOn: 'X'` or a `text: 'X'` line is aiming at. */
const tapTarget = (line: string): string | null => {
  const inline = /^\s*-\s+tapOn:\s*['"]?(.+?)['"]?\s*$/.exec(line);
  if (inline) return inline[1];
  const nested = /^\s*text:\s*['"]?(.+?)['"]?\s*$/.exec(line);
  return nested ? nested[1] : null;
};

describe('a flow puts the keyboard away before it taps a docked button', () => {
  const screens = dockedScreens();

  it('found the screens whose footer the keyboard covers', () => {
    expect(screens.length).toBeGreaterThan(5);
    const files = screens.map((s) => s.file);
    expect(files).toContain('app/compose-request.tsx');
    // The two that carry no allowance of their own and are only found by the
    // avoidKeyboard + footer arm. Their docked buttons are "Save changes" and
    // "Delete forever", so losing them from this set is the expensive kind of
    // silent narrowing.
    expect(files).toContain('features/trips/trip-editor.tsx');
    expect(files).toContain('app/profile-me.tsx');
    expect(screens.find((s) => s.file === 'app/profile-me.tsx')?.labels).toContain(
      'Delete forever'
    );
  });

  it.each(flowFiles().map((f) => [path.basename(f), f] as const))('%s', (_name, file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const offenders: string[] = [];
    // The screen whose field was last typed into, i.e. whose keyboard is up.
    let typing: { file: string; labels: string[]; at: number } | null = null;

    lines.forEach((line, i) => {
      const target = tapTarget(line);
      // The offence is checked BEFORE the ways out, because two of those
      // words ('Done', 'Back') are themselves docked labels on some screen:
      // tapping one under a raised keyboard is the same bug by another name.
      if (typing && target !== null && typing.labels.includes(target)) {
        offenders.push(
          `${path.basename(file)}:${i + 1} taps '${target}', docked under the keyboard raised at ` +
            `line ${typing.at} (${typing.file}). Tap 'Hide keyboard' first.`
        );
        typing = null;
        return;
      }
      // Anything that blurs the field, or leaves the screen entirely.
      // `pressKey: Enter` is a list item, not a nested key — iOS blurs a
      // single-line field on Return, which is the dismissal these flows used
      // before there was a bar to tap.
      if (
        (target !== null && ['Hide keyboard', 'Close', 'Cancel', 'Discard'].includes(target)) ||
        /^\s*-\s+pressKey:\s*Enter\s*$/.test(line) ||
        /^\s*-\s+(back|launchApp|runFlow)\b/.test(line)
      ) {
        typing = null;
        return;
      }
      // A field is focused, then typed into: from here the keyboard is up.
      const id = /^\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
      if (id) {
        const screen = screens.find((s) => s.ids.includes(id[1]));
        const typed = lines.slice(i + 1, i + 4).some((next) => /^\s*-\s+inputText\b/.test(next));
        if (screen && typed) typing = { file: screen.file, labels: screen.labels, at: i + 1 };
      }
    });

    expect(offenders).toEqual([]);
  });
});
