import {
  closeDayLabel,
  finiteDate,
  groupClosesAt,
  hasGroupClosed,
} from '@/features/groups/closing';

describe('when a group chat closes', () => {
  // Noon UTC on the day after, and the noon is the whole decision. "Active
  // through the 10th" has to hold until 23:59 on the 10th wherever you are,
  // and the last place on earth to finish its 10th is UTC-12 at 11:59 UTC on
  // the 11th.
  it('closes at noon UTC the day after the last active day', () => {
    expect(groupClosesAt('2026-09-10')?.toISOString()).toBe('2026-09-11T12:00:00.000Z');
  });

  it('never closes when there is no end date', () => {
    expect(groupClosesAt(null)).toBeNull();
    expect(hasGroupClosed(null, new Date('2099-01-01T00:00:00Z'))).toBe(false);
  });

  // The one that matters: somebody at UTC-12 must still be able to post at
  // their own 23:59 on the last day.
  it('is still open at the very end of the last day in the westernmost timezone', () => {
    // 23:59 on the 10th at UTC-12 is 11:59 UTC on the 11th.
    expect(hasGroupClosed('2026-09-10', new Date('2026-09-11T11:59:00Z'))).toBe(false);
  });

  it('and has closed one minute later', () => {
    expect(hasGroupClosed('2026-09-10', new Date('2026-09-11T12:01:00Z'))).toBe(true);
  });

  // Month and year boundaries, because the arithmetic is +1 day on a date
  // string and a naive implementation produces the 32nd of a month.
  it('rolls over the end of a month', () => {
    expect(groupClosesAt('2026-09-30')?.toISOString()).toBe('2026-10-01T12:00:00.000Z');
  });

  it('and the end of a year', () => {
    expect(groupClosesAt('2026-12-31')?.toISOString()).toBe('2027-01-01T12:00:00.000Z');
  });

  it('and a leap day', () => {
    expect(groupClosesAt('2028-02-29')?.toISOString()).toBe('2028-03-01T12:00:00.000Z');
  });
});

describe('the day we tell people it closed', () => {
  // Derived from the INSTANT in the reader's own zone, not from the date
  // string plus one. East of UTC+12 those disagree: a chat dated the 10th
  // closes at 2026-09-11 12:00 UTC, which is already the 12th in Auckland,
  // and printing "Sep 11" there names a day the members can disprove from
  // their own scrollback.
  it('names the day the composer actually went away, in the reader zone', () => {
    const closesAt = groupClosesAt('2026-09-10')!;
    const inReaderZone = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(closesAt);
    expect(closeDayLabel('2026-09-10')).toBe(inReaderZone);
  });

  it('has nothing to say about a chat with no end date', () => {
    expect(closeDayLabel(null)).toBeNull();
  });
});

describe('finiteDate', () => {
  // room_members.expires_at is NOT NULL, so the admin of a no-end-date group
  // holds an infinite seat and PostgREST sends it as the literal string
  // "infinity". It is truthy, and `new Date('infinity')` is Invalid Date, so
  // a plain truthiness guard renders "you leave Invalid Date".
  it('refuses the string the server sends for an endless seat', () => {
    expect(finiteDate('infinity')).toBeNull();
  });

  it('and passes a real timestamp through', () => {
    expect(finiteDate('2026-09-17T00:00:00Z')?.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('and handles no value at all', () => {
    expect(finiteDate(null)).toBeNull();
  });
});
