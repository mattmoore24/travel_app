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
 *
 * The DATE half is the same defect one field over, and it is guarded the same
 * way below. Thirteen formatters named 'en' by hand and four passed
 * `undefined`, which is the device, so a Portuguese phone drew "agosto 2026"
 * as a calendar header with "Aug 30 to Sep 2" in the summary directly beneath
 * it. lib/locale's `dates()` is the one answer; ADOPTION_OUTSTANDING is every
 * file that has not moved onto it yet, and it may only ever shrink.
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

/**
 * The files that still name a locale of their own, one line each, each
 * belonging to a subsystem this package could not reach.
 *
 * This list is a DEBT, not an allowance. A file may leave it; nothing may
 * join it. The guard below is deliberately a subset check rather than an
 * equality check, so the package that finally moves `features/trips/dates.ts`
 * does not have to come back and edit this file to stay green - it just gets
 * one entry deader than it was.
 *
 * The four that pass `undefined` are the ones producing the actual bug on a
 * non-English phone; the rest say 'en' and are merely a second engine that
 * will drift. They are marked so whoever picks this up knows which half is
 * user-visible today.
 */
const ADOPTION_OUTSTANDING = new Set([
  // Device locale today, so these are the four screens a Portuguese phone
  // renders in Portuguese beside English rows.
  path.join('src', 'app', 'room', '[id].tsx'),
  path.join('src', 'features', 'chat', 'chat-row.tsx'),
  path.join('src', 'features', 'groups', 'closing.ts'),
  path.join('src', 'features', 'trips', 'trip-calendar.tsx'),
  // `toLocaleDateString()` with no argument at all, which is both the device
  // locale AND the numeric shape lib/locale deliberately does not offer.
  path.join('src', 'features', 'auth', 'gate-copy.ts'),
  // Pinned to 'en', so they read correctly today and are a second engine.
  path.join('src', 'features', 'chat', 'row-kind.ts'),
  path.join('src', 'features', 'pins', 'map-filter-sheet.tsx'),
  path.join('src', 'features', 'pins', 'pin-helpers.ts'),
  path.join('src', 'features', 'trips', 'dates.ts'),
]);

describe('the app prints a day from exactly one place too', () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith(path.join('lib', 'locale.ts')));

  /**
   * A formatter somebody READS. Two constructions are computations and are
   * not second engines:
   *
   *   * `.formatToParts` reads the numbers back out (cityClockNow builds a
   *     Date in a city's zone with it), and must stay locale-independent
   *     precisely because nobody ever sees its output.
   *   * `.resolvedOptions()` asks the platform what zone it is in and formats
   *     nothing at all.
   */
  function renderedFormatters(code: string): string[] {
    const found: string[] = [];
    for (const m of code.matchAll(/new Intl\.DateTimeFormat\([^)]*\)(\s*\.\w+)?/gs)) {
      if (!m[0].includes('.formatToParts') && !m[0].includes('.resolvedOptions')) {
        found.push(m[0].replace(/\s+/g, ' ').slice(0, 90));
      }
    }
    for (const m of code.matchAll(/\.toLocale(Date|Time)?String\(/g)) {
      found.push(m[0]);
    }
    return found;
  }

  it('has no NEW file naming a locale of its own', () => {
    const offenders = new Set<string>();
    for (const file of files) {
      const rel = path.relative(REPO, file);
      if (ADOPTION_OUTSTANDING.has(rel)) {
        continue;
      }
      if (renderedFormatters(fs.readFileSync(file, 'utf8')).length > 0) {
        offenders.add(rel);
      }
    }
    // Sorted so the failure names the file rather than a Set's insertion
    // order, and the fix is always "call lib/locale's dates() instead".
    expect([...offenders].sort()).toEqual([]);
  });

  it('and every entry on the outstanding list is still a real file', () => {
    // A stale path is worse than a missing guard: it silently exempts nothing
    // while looking like it exempts something, and the day somebody renames
    // that file the exemption quietly becomes a hole.
    for (const rel of ADOPTION_OUTSTANDING) {
      expect(fs.existsSync(path.join(REPO, rel))).toBe(true);
    }
  });

  it('is reached by the chat list, whose two engines started this', () => {
    const chat = fs.readFileSync(path.join(SRC, 'features', 'chat', 'separators.ts'), 'utf8');
    expect(chat).toContain('dates().weekdayMonthDay');
    expect(chat).toContain('dates().monthDay');
    expect(chat).toContain('dates().weekday.');
  });

  it('names its locale once, and it is not the device', () => {
    const locale = fs.readFileSync(path.join(SRC, 'lib', 'locale.ts'), 'utf8');
    expect(locale).toContain("export const LOCALE = 'en'");
    // Every formatter in the file is built from that one constant. A literal
    // tag inside `dates()` or `clocks()` is exactly the drift this guards.
    const built = [...locale.matchAll(/new Intl\.DateTimeFormat\(\s*([A-Za-z_'"][^,)]*)/g)].map(
      (m) => m[1].trim()
    );
    expect(built.length).toBeGreaterThan(2);
    expect(new Set(built)).toEqual(new Set(['LOCALE']));
  });
});

/**
 * ONE place asks the phone, which is the same defect one layer under the two
 * above.
 *
 * The clock and the date engine both went wrong because more than one file
 * answered the same question. The QUESTION under both of them is "what is
 * this phone set to", and lib/locale is the one file that asks it - stated in
 * that file, stated again in docs/ARCHITECTURE.md D5, and enforced by nothing
 * until now. A day after D5 was written, src/lib/device-locale.ts called
 * `getLocales()` a second time, with a near-verbatim copy of lib/locale's own
 * widening rationale, and neither document was updated. It was caught in
 * review; the third one should not have to be.
 *
 * Note what this does NOT say: nothing here stops a file from reading the
 * phone's language, it stops a file from asking the PHONE for it. Import
 * `DEVICE_LOCALE`, `DEVICE_LOCALE_TAG` or any of the rest from lib/locale as
 * often as is useful - one answer, however many readers.
 */
describe('the phone is asked from exactly one place', () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith(path.join('lib', 'locale.ts')));

  it('has no second caller of expo-localization', () => {
    const offenders = files
      .filter((f) =>
        /(?:from|require\()\s*['"]expo-localization['"]/.test(fs.readFileSync(f, 'utf8'))
      )
      .map((f) => path.relative(REPO, f))
      .sort();
    // The fix is always the same: import what you need from '@/lib/locale',
    // and add it there if it is not exported yet.
    expect(offenders).toEqual([]);
  });

  it('and the one write that needed the raw tag asks lib/locale for it', () => {
    // profiles.locale takes the tag with NO fallback, because null means
    // English silently and a guessed language is a rejection somebody cannot
    // read. That is a different export from the formatter's `DEVICE_LOCALE`,
    // and lib/locale is where the difference is documented.
    const write = fs.readFileSync(path.join(SRC, 'lib', 'device-locale.ts'), 'utf8');
    expect(write).toContain("from '@/lib/locale'");
    expect(write).toContain('DEVICE_LOCALE_TAG');
  });
});

/**
 * A Portuguese phone, so the assertions below are about what a non-English
 * device gets rather than about what the runner happens to be set to. This is
 * the exact configuration that used to draw "agosto 2026" as a calendar
 * header with "Aug 30 to Sep 2" in the summary directly beneath it.
 */
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'pt-PT', languageCode: 'pt' }],
  getCalendars: () => [{ uses24hourClock: true, firstWeekday: 2, timeZone: 'UTC' }],
}));

describe('one language on one screen', () => {
  // Required lazily so the mock above is in place before the module reads it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const locale = require('@/lib/locale') as typeof import('@/lib/locale');
  // Midday UTC, so no runner's timezone can move it into a different month.
  const day = new Date('2026-08-30T12:00:00Z');

  it('writes its months in English however the phone is set', () => {
    expect(locale.dates().monthDay.format(day)).toContain('Aug');
    expect(locale.dates().weekdayMonthDay.format(day)).toContain('Aug');
    expect(locale.dates().monthYear.format(day)).toContain('August');
    // The bug this closes is not "Portuguese" - it is TWO languages on one
    // screen. Nothing below may come back in the device's language while the
    // rest of the row is English.
    expect(locale.dates().monthYear.format(day)).not.toContain('agosto');
  });

  it('still lets the CONVENTIONS follow the phone, which is the clock', () => {
    // Twelve-versus-twenty-four changes what the digits MEAN, so it follows
    // the device. A month name is just a word, and this app's words are
    // English. That split is the whole design of lib/locale.
    expect(locale.USES_24_HOUR_CLOCK).toBe(true);
    expect(locale.clocks().instant.format(day)).not.toMatch(/AM|PM/i);
  });

  it('offers no numeric date at all', () => {
    // "3/4" is March 4 to an American and 3 April to nearly everyone else
    // this app is for, and its readers are by definition abroad. Keeping the
    // shape out of the vocabulary is how that stays true of every screen.
    for (const format of Object.values(locale.dates())) {
      expect(format.format(day)).toMatch(/[A-Za-z]/);
    }
  });
});
