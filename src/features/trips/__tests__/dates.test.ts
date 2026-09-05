import {
  addDays,
  formatDateRange,
  formatTripDates,
  parseISODate,
  rangeForRoughDates,
  roughWhen,
  toISODate,
  validateTripRange,
} from '../dates';

describe('trip date helpers (date-only, timezone-safe)', () => {
  it('round-trips ISO dates through local parsing', () => {
    expect(toISODate(parseISODate('2026-03-04'))).toBe('2026-03-04');
    expect(toISODate(parseISODate('2026-12-31'))).toBe('2026-12-31');
  });

  it('formats same-month ranges compactly', () => {
    const year = new Date().getFullYear() + 1; // force year display
    expect(formatDateRange(`${year}-03-04`, `${year}-03-09`)).toContain('Mar 4');
    expect(formatDateRange(`${year}-03-04`, `${year}-03-09`)).toContain(String(year));
  });

  it('formats cross-month ranges with both months', () => {
    const range = formatDateRange('2030-03-30', '2030-04-02');
    expect(range).toContain('Mar 30');
    expect(range).toContain('Apr 2');
  });

  it('mirrors the DB trip rules', () => {
    const today = toISODate(new Date());
    const nextWeek = toISODate(addDays(new Date(), 7));
    const lastMonth = toISODate(addDays(new Date(), -30));
    const inThreeYears = toISODate(addDays(new Date(), 3 * 365));

    expect(validateTripRange(today, nextWeek)).toBeNull();
    expect(validateTripRange(nextWeek, today)).not.toBeNull(); // ends before start
    expect(validateTripRange(lastMonth, lastMonth)).not.toBeNull(); // fully past
    expect(validateTripRange(inThreeYears, inThreeYears)).not.toBeNull(); // too far out
    expect(validateTripRange(today, toISODate(addDays(new Date(), 400)))).not.toBeNull(); // longer than a year
  });
});

describe('a trip that is roughly when', () => {
  // The rule the picker, the profile and the overlap query all have to agree
  // on, asserted as the sentences the package spec wrote it as.
  it('turns a month and a length into the widest range that month can mean', () => {
    // "About a week in September" is Sep 1 – 30: the traveler picked the
    // month, so the month is the claim.
    expect(rangeForRoughDates('2030-09', 7)).toEqual({ start: '2030-09-01', end: '2030-09-30' });
    expect(rangeForRoughDates('2030-09', 14)).toEqual({ start: '2030-09-01', end: '2030-09-30' });
  });

  it('knows how long every month is, February included', () => {
    expect(rangeForRoughDates('2028-02', 7)).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(rangeForRoughDates('2030-02', 7)).toEqual({ start: '2030-02-01', end: '2030-02-28' });
    expect(rangeForRoughDates('2030-04', 4)).toEqual({ start: '2030-04-01', end: '2030-04-30' });
  });

  it('pushes the far edge out only for a stay the month cannot hold', () => {
    // Two months from September ends in late October, NOT in late November.
    // A window that overlapped all of September AND all of October would
    // inflate every match count in the city.
    expect(rangeForRoughDates('2030-09', 60)).toEqual({ start: '2030-09-01', end: '2030-10-30' });
  });

  it('cannot outrun the 365-day check on the table', () => {
    // A month a few ahead of this one, so the other client rule - a start no
    // more than 730 days out - is not what the assertion trips over.
    const soon = new Date();
    soon.setDate(1);
    soon.setMonth(soon.getMonth() + 3);
    const monthISO = `${soon.getFullYear()}-${`${soon.getMonth() + 1}`.padStart(2, '0')}`;
    const wide = rangeForRoughDates(monthISO, 900);
    expect(validateTripRange(wide.start, wide.end)).toBeNull();
    expect(wide.end).toBe(toISODate(addDays(parseISODate(wide.start), 365)));
  });

  it('says a rough window is a guess in the line the dates are on', () => {
    // Next year, so formatDateRange prints the year and the strings below
    // cannot start reading differently on the first run of a new January.
    const year = new Date().getFullYear() + 1;
    expect(formatTripDates(`${year}-09-01`, `${year}-09-30`, true)).toBe(
      `Around Sep 1 – 30, ${year}`
    );
    expect(formatTripDates(`${year}-09-01`, `${year}-09-30`, false)).toBe(`Sep 1 – 30, ${year}`);
    // Absent reads as exact: a source that has not been widened for the
    // column must not start hedging every trip in the app.
    expect(formatTripDates(`${year}-09-01`, `${year}-09-30`)).toBe(`Sep 1 – 30, ${year}`);
  });

  it('drops to month scale where a sentence has no room for a hedge', () => {
    // For "In Lisbon from Sep 3", which cannot be repaired by a prefix: the
    // sentence is built around one arrival day.
    const year = new Date().getFullYear();
    expect(roughWhen(`${year}-09-01`, `${year}-09-30`)).toBe('in September');
    expect(roughWhen(`${year}-09-01`, `${year}-10-30`)).toBe('between September and October');
  });

  it('names the year on a month that is not in this one', () => {
    const next = new Date().getFullYear() + 1;
    expect(roughWhen(`${next}-09-01`, `${next}-09-30`)).toBe(`in September ${next}`);
  });
});
