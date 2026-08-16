import { addDays, formatDateRange, parseISODate, toISODate, validateTripRange } from '../dates';

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
