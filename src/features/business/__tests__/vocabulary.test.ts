import {
  answerComparison,
  comparisonRank,
  comparisonsDone,
  cityNow,
  isOpenNow,
  openLine,
  startComparison,
  waitNote,
} from '@/features/business/vocabulary';
import type { BusinessHourJson, MyRatingRow, RatingBucket } from '@/lib/database.types';

function hour(weekday: number, opens: string, closes: string): BusinessHourJson {
  return { weekday, opens, closes };
}

/**
 * A clock reading, as a real date.
 *
 * The week of 23 August 2026 starts on a Sunday, so the day offset IS the
 * weekday number the hour rows are keyed by, and the two can never drift.
 * Built with the local-time constructor because `getDay()` and `getHours()`
 * read local time, and a UTC literal would move the answer with the runner's
 * timezone.
 */
function at(weekday: number, hours24: number, minutes = 0): Date {
  return new Date(2026, 7, 23 + weekday, hours24, minutes);
}

const SUN = 0;
const WED = 3;
const THU = 4;
const FRI = 5;
const SAT = 6;

describe('isOpenNow', () => {
  const nineToFive = [hour(WED, '09:00:00', '17:00:00')];

  it('is open between the hours of a normal daytime row', () => {
    expect(isOpenNow(nineToFive, at(WED, 12))).toBe(true);
    expect(isOpenNow(nineToFive, at(WED, 9))).toBe(true);
  });

  // Closing time is the moment it shuts, not a last minute of being open.
  // Standing outside at 17:00 is standing outside a closed door.
  it('is shut before it opens and at the closing time itself', () => {
    expect(isOpenNow(nineToFive, at(WED, 8, 59))).toBe(false);
    expect(isOpenNow(nineToFive, at(WED, 17))).toBe(false);
  });

  it('is still open at one in the morning for a bar that shuts at two', () => {
    const fridayNight = [hour(FRI, '20:00:00', '02:00:00')];
    expect(isOpenNow(fridayNight, at(FRI, 21))).toBe(true);
    // The case the naive version gets wrong: it is Saturday now, and the row
    // that keeps this place open belongs to Friday.
    expect(isOpenNow(fridayNight, at(SAT, 1))).toBe(true);
    expect(isOpenNow(fridayNight, at(SAT, 3))).toBe(false);
    expect(isOpenNow(fridayNight, at(FRI, 19))).toBe(false);
  });

  // Saturday night into Sunday morning is the one that walks off the end of
  // the week, so it exercises the wrap rather than plain subtraction.
  it('carries a Saturday night row across into Sunday', () => {
    const saturdayNight = [hour(SAT, '22:00:00', '04:00:00')];
    expect(isOpenNow(saturdayNight, at(SUN, 2))).toBe(true);
    expect(isOpenNow(saturdayNight, at(SUN, 5))).toBe(false);
  });

  // null and false are different answers and the caller branches on it: a
  // place with no hours shows plain text, a place that is shut says so. A
  // wrong "Open" sends somebody across a city.
  it('says it does not know when there are no hours at all', () => {
    expect(isOpenNow([], at(WED, 12))).toBeNull();
  });

  it('says shut, not unknown, on a weekday the place has no row for', () => {
    expect(isOpenNow(nineToFive, at(THU, 12))).toBe(false);
  });
});

describe('openLine', () => {
  const nineToFive = [hour(WED, '09:00:00', '17:00:00')];

  it('quotes the closing time while the place is open', () => {
    expect(openLine(nineToFive, at(WED, 12))).toBe('Open · till 17:00');
  });

  it('quotes the opening time while the place is shut but opens later today', () => {
    expect(openLine(nineToFive, at(WED, 8))).toBe('Closed · opens 09:00');
  });

  it('says closed today when there is no row for today to quote', () => {
    expect(openLine(nineToFive, at(THU, 12))).toBe('Closed today');
  });

  it('says nothing at all when the hours are unknown', () => {
    expect(openLine([], at(WED, 12))).toBeNull();
  });
});

describe('waitNote', () => {
  const nineToFive = [hour(WED, '09:00:00', '17:00:00')];

  it('says nothing while the business is open', () => {
    expect(waitNote(nineToFive, at(WED, 12))).toBeNull();
  });

  // Unknown is not closed. Defaulting to "closed" here would have every
  // business with no hours filled in telling travelers it is shut.
  it('says nothing when the hours are unknown', () => {
    expect(waitNote([], at(WED, 12))).toBeNull();
  });

  it('sets the expectation when the business is closed', () => {
    expect(waitNote(nineToFive, at(WED, 8))).toBe(
      'Closed right now. They will probably answer when they open.'
    );
    expect(waitNote(nineToFive, at(THU, 12))).toBe(
      'Closed right now. They will probably answer when they open.'
    );
  });

  it('judges closed against the city clock, not the reader clock', () => {
    // Weekday 3: a Bangkok bar, open 20:00-02:00. 15:00 UTC is 22:00-ish there.
    const bangkokNight = [{ weekday: 3, opens: '20:00:00', closes: '02:00:00' }];
    const duringOpening = new Date('2026-08-26T15:00:00Z');
    expect(waitNote(bangkokNight, duringOpening, 100.5)).toBeNull();
  });
});

/** Highest score first, which is the order `my_ratings()` returns and rank reads. */
function rated(bucket: RatingBucket, names: string[]): MyRatingRow[] {
  return names.map((name, index) => ({
    business_id: `${bucket}-${index}`,
    name,
    bucket,
    score: 10 - index,
  }));
}

const SIX_LOVED = rated('loved', [
  'Casa do Bairro',
  'Sol e Pesca',
  'Damas',
  'A Tasca',
  'Park',
  'Pensão Amor',
]);

/** Every path through the search, as four yes/no answers. */
const ANSWER_PATHS = Array.from({ length: 16 }, (_, mask) =>
  [0, 1, 2, 3].map((step) => ((mask >> step) & 1) === 1)
);

function walk(mine: MyRatingRow[], answers: boolean[]) {
  let current = startComparison('loved', mine);
  let asked = 0;
  const seen: string[] = [];
  while (!comparisonsDone(current, asked)) {
    seen.push(current.against!.name);
    current = answerComparison(current, 'loved', mine, answers[asked] ?? true);
    asked += 1;
  }
  return { asked, seen, rank: comparisonRank(current), ranOut: current.against == null };
}

describe('the comparisons', () => {
  it('asks nothing at all when there is nothing yet to compare against', () => {
    const start = startComparison('loved', []);
    expect(start.against).toBeNull();
    expect(comparisonsDone(start, 0)).toBe(true);
    // A first rating has only its bucket to go on, and the middle of the
    // bucket is what that means. The server derives the score from it.
    expect(comparisonRank(start)).toBe(0.5);
  });

  it('only ever offers a place from the bucket you picked', () => {
    const mine = [
      ...SIX_LOVED,
      ...rated('fine', ['The Rooftop', 'Ler Devagar', 'Tasca do Chico']),
      ...rated('not_for_me', ['The Irish Bar']),
    ];
    const lovedNames = SIX_LOVED.map((row) => row.name);
    for (const answers of ANSWER_PATHS) {
      const { seen } = walk(mine, answers);
      // Not vacuous: a run that asked nothing would pass the loop below.
      expect(seen.length).toBeGreaterThan(0);
      for (const name of seen) {
        expect(lovedNames).toContain(name);
      }
    }
  });

  it('runs out of places to ask about before the four-answer cap, at this size', () => {
    for (const answers of ANSWER_PATHS) {
      const { asked, ranOut } = walk(SIX_LOVED, answers);
      expect(asked).toBeLessThanOrEqual(4);
      // The window closing on its own is the healthy stop. If this ever
      // fails, the search is being cut off mid-way and the score it hands
      // the server is a guess rather than an answer.
      expect(ranOut).toBe(true);
    }
  });

  it('lands inside the bucket, whatever the answers were', () => {
    for (const answers of ANSWER_PATHS) {
      const { rank } = walk(SIX_LOVED, answers);
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(rank).toBeLessThanOrEqual(1);
    }
  });

  it('puts a place you preferred every time above one you preferred to nothing', () => {
    const best = walk(SIX_LOVED, [true, true, true, true]).rank;
    const worst = walk(SIX_LOVED, [false, false, false, false]).rank;
    expect(best).toBeGreaterThan(worst);
  });

  // The backstop for a long list, where halving the window takes more than
  // four questions. Nobody is asked a fifth.
  it('stops at four answers even with the window still wide open', () => {
    const wideOpen = { lo: 0, hi: 1, against: SIX_LOVED[0] };
    expect(comparisonsDone(wideOpen, 3)).toBe(false);
    expect(comparisonsDone(wideOpen, 4)).toBe(true);
  });

  it('stops once the window is tighter than a tenth of the bucket', () => {
    const tight = { lo: 0.5, hi: 0.55, against: SIX_LOVED[0] };
    expect(comparisonsDone(tight, 0)).toBe(true);
  });
});

// The reader's clock is the wrong clock. Somebody in Lisbon looking at a
// Bangkok bar would otherwise be told "Open" seven hours out, and the plan is
// explicit that a wrong "Open" is worse than no answer because it sends
// somebody across a city.
describe('cityNow', () => {
  const utcNoon = new Date('2026-08-26T12:00:00Z');

  it('leaves the reader alone when the place has no longitude', () => {
    expect(cityNow(utcNoon, null).getTime()).toBe(utcNoon.getTime());
  });

  // Longitude, not a real timezone: fifteen degrees an hour. Bangkok's
  // political offset is +7 and its longitude gives +6.7, so these assert the
  // contract the function actually makes, which is "within an hour", not the
  // political answer it never promised.
  const hoursFrom = (lng: number) =>
    (cityNow(utcNoon, lng).getTime() - utcNoon.getTime()) / 3_600_000;

  it('reads a place east of the meridian as later in the day', () => {
    // Bangkok, 100.5E. True offset +7.
    expect(hoursFrom(100.5)).toBeGreaterThan(6);
    expect(hoursFrom(100.5)).toBeLessThan(8);
  });

  it('and one west of it as earlier', () => {
    // Mexico City, 99.13W. True offset -6.
    expect(hoursFrom(-99.133)).toBeLessThan(-5);
    expect(hoursFrom(-99.133)).toBeGreaterThan(-7);
  });

  it('so a bar open past midnight there reads shut from here', () => {
    // Weekday 3: 15:00 UTC on 26 Aug 2026 is a Wednesday evening in Bangkok.
    const bangkokNight = [{ weekday: 3, opens: '20:00:00', closes: '02:00:00' }];
    // 22:00 in Bangkok is 15:00 UTC on the same Wednesday.
    const duringOpening = new Date('2026-08-26T15:00:00Z');
    expect(openLine(bangkokNight, duringOpening, 100.5)).toBe('Open · till 02:00');
    // The same instant, judged against a UTC reader's own clock, is 15:00 on a
    // Wednesday: shut, and the wrong answer.
    expect(openLine(bangkokNight, duringOpening, null)).not.toBe('Open · till 02:00');
  });
});

describe('openLine on a day with two shifts', () => {
  // 09:00-14:00 and 18:00-23:00: a kitchen that shuts in the afternoon.
  const SPLIT = [
    { weekday: 3, opens: '09:00:00', closes: '14:00:00' },
    { weekday: 3, opens: '18:00:00', closes: '23:00:00' },
  ];

  // A Wednesday. Built from parts so the assertion is about the clock and
  // not about whatever timezone the test runner happens to be in.
  const wednesdayAt = (hour: number, minute = 0) => new Date(2026, 7, 26, hour, minute);

  it('quotes the evening service, not this morning, in the gap between them', () => {
    expect(openLine(SPLIT, wednesdayAt(16))).toBe('Closed · opens 18:00');
  });

  it('is open during either shift', () => {
    expect(openLine(SPLIT, wednesdayAt(11))).toBe('Open · till 14:00');
    expect(openLine(SPLIT, wednesdayAt(20))).toBe('Open · till 23:00');
  });

  // Before the first opening there IS something later today, so no "tomorrow".
  it('quotes this morning before it opens', () => {
    expect(openLine(SPLIT, wednesdayAt(7))).toBe('Closed · opens 09:00');
  });

  // After the last close there is nothing left today, and saying "opens
  // 09:00" flat would read as a place that is about to open.
  it('says tomorrow once the day is done', () => {
    expect(openLine(SPLIT, wednesdayAt(23, 30))).toBe('Closed · opens 09:00 tomorrow');
  });
});
