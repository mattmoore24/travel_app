import fs from 'node:fs';
import path from 'node:path';

/**
 * ONE clock, and the test is a source scan because that is the only way to
 * see the defect.
 *
 * biz-one-clock exists because the app kept two: chat separators formatted
 * with no `hour12` (12-hour on every phone) while business hours came through
 * as a slice of '18:00:00' (24-hour), so a traveler read "9:14 PM" on a
 * message and "Open · till 02:00" on the bar it was about.
 *
 * The batch that was meant to close it built the shared accessor inside
 * features/business/vocabulary and never wired chat to it, then added a THIRD
 * formatter. Two review lenses caught that the file the package is about was
 * never touched. So the guard is not "does the shared clock exist" - it did -
 * but "is there anything ELSE that prints an hour".
 */
const REPO = path.join(__dirname, '..', '..', '..');
const SRC = path.join(REPO, 'src');

/** Every .ts/.tsx under src/, excluding tests and the clock's own home. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('the app prints an hour from exactly one place', () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith(path.join('lib', 'locale.ts')));

  it('finds the source to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no other formatter that renders an hour', () => {
    // An Intl.DateTimeFormat carrying `hour` anywhere but lib/locale is a
    // second answer to the question lib/locale exists to answer once. A date
    // formatter (weekday/month/day, no hour) is fine and common.
    const offenders: string[] = [];
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8');
      for (const m of code.matchAll(/new Intl\.DateTimeFormat\([^)]*\)(\s*\.\w+)?/gs)) {
        // `.formatToParts` is a COMPUTATION, not a rendering: cityClockNow
        // reads the numbers back out to build a Date in a city's zone, and it
        // must stay locale-independent and 24-hour precisely because nobody
        // ever sees its output. Only a formatter somebody READS is a second
        // clock.
        if (/\bhour\s*:/.test(m[0]) && !m[0].includes('.formatToParts')) {
          offenders.push(`${path.relative(REPO, file)}: ${m[0].replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('and the one that does follows the phone rather than pinning a format', () => {
    const locale = fs.readFileSync(path.join(SRC, 'lib', 'locale.ts'), 'utf8');
    expect(locale).toContain('hour12: !USES_24_HOUR_CLOCK');
    // Pinning either way is the fix that looks right and is not: it makes the
    // two agree only on phones already set that way.
    expect(locale).not.toContain('hour12: false');
    expect(locale).not.toContain('hour12: true');
  });

  it('is reached by chat and by business alike', () => {
    const chat = fs.readFileSync(path.join(SRC, 'features', 'chat', 'separators.ts'), 'utf8');
    const biz = fs.readFileSync(path.join(SRC, 'features', 'business', 'vocabulary.ts'), 'utf8');
    expect(chat).toContain("from '@/lib/locale'");
    expect(chat).toContain('clocks().instant');
    expect(biz).toContain("from '@/lib/locale'");
    expect(biz).toContain('clocks().wall');
  });
});
