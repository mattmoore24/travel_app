import type {
  BusinessCategory,
  BusinessHourJson,
  BusinessLinkKind,
  BusinessReportReason,
  MyRatingRow,
  RatingBucket,
  RatingTag,
} from '@/lib/database.types';

/**
 * The words a traveler sees, in one place.
 *
 * Two vocabulary rules from the design brief run through all of it. Travelers
 * never see the word "business" - they see a place. And nothing is ever
 * called a "pin": that word is load-bearing in §7 rule 3, where it means a
 * traveler's 72-hour marker, and a permanent commercial listing borrowing it
 * would blur the one distinction the rule exists to draw.
 */

export const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  hostel: 'Hostel',
  hotel: 'Hotel',
  guesthouse: 'Guesthouse',
  bar: 'Bar',
  restaurant: 'Restaurant',
  cafe: 'Cafe',
  club: 'Club',
  tour: 'Tour',
  activity: 'Activity',
  coworking: 'Coworking',
  wellness: 'Wellness',
  shop: 'Shop',
  other: 'Somewhere else',
};

/** SF Symbols first, with Material names for the other two platforms. */
export const CATEGORY_ICON: Record<
  BusinessCategory,
  { ios: string; android: string; web: string }
> = {
  hostel: { ios: 'bed.double.fill', android: 'hotel', web: 'hotel' },
  hotel: { ios: 'building.2.fill', android: 'apartment', web: 'apartment' },
  guesthouse: { ios: 'house.fill', android: 'home', web: 'home' },
  bar: { ios: 'wineglass.fill', android: 'local_bar', web: 'local_bar' },
  restaurant: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  cafe: { ios: 'cup.and.saucer.fill', android: 'local_cafe', web: 'local_cafe' },
  club: { ios: 'music.note', android: 'nightlife', web: 'nightlife' },
  tour: { ios: 'figure.walk', android: 'tour', web: 'tour' },
  activity: { ios: 'figure.hiking', android: 'hiking', web: 'hiking' },
  coworking: { ios: 'laptopcomputer', android: 'work', web: 'work' },
  wellness: { ios: 'leaf.fill', android: 'spa', web: 'spa' },
  shop: { ios: 'bag.fill', android: 'storefront', web: 'storefront' },
  other: { ios: 'mappin', android: 'place', web: 'place' },
};

/** In the order the signup picker offers them. `other` last, as a real answer. */
export const CATEGORY_ORDER: BusinessCategory[] = [
  'hostel',
  'hotel',
  'guesthouse',
  'bar',
  'restaurant',
  'cafe',
  'club',
  'tour',
  'activity',
  'coworking',
  'wellness',
  'shop',
  'other',
];

export const LINK_LABEL: Record<BusinessLinkKind, string> = {
  website: 'Website',
  reservations: 'Book a table',
  tickets: 'Buy tickets',
  menu: 'Menu',
  phone: 'Call',
  email: 'Email',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  x: 'X',
  other: 'Link',
};

export const REPORT_REASONS: { value: BusinessReportReason; label: string }[] = [
  { value: 'not_this_business', label: "This isn't the real place" },
  { value: 'not_a_real_place', label: "It doesn't exist" },
  { value: 'permanently_closed', label: "It's closed for good" },
  { value: 'wrong_location', label: "It's in the wrong spot" },
  { value: 'spam_or_offensive', label: 'Spam or something offensive' },
];

export const BUCKET_LABEL: Record<RatingBucket, string> = {
  loved: 'Loved it',
  fine: 'It was fine',
  not_for_me: 'Not for me',
};

/** Highest first, because that is the order somebody thinks in. */
export const BUCKET_ORDER: RatingBucket[] = ['loved', 'fine', 'not_for_me'];

export const TAG_LABEL: Record<RatingTag, string> = {
  good_for_meeting_people: 'Good for meeting people',
  cheap: 'Cheap',
  quiet: 'Quiet',
  lively: 'Lively',
  late: 'Open late',
  good_coffee: 'Good coffee',
  worth_the_trip: 'Worth the trip',
};

export const TAG_ORDER: RatingTag[] = [
  'good_for_meeting_people',
  'cheap',
  'quiet',
  'lively',
  'late',
  'good_coffee',
  'worth_the_trip',
];

/** Three, matching the cap the database enforces. */
export const MAX_TAGS = 3;

/** Below this a place reads "Not rated yet". The server returns nulls anyway. */
export const RATING_FLOOR = 5;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minutesOf(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** '18:00:00' -> '18:00'. Seconds are never useful to a person. */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}

export function weekdayLabel(weekday: number): string {
  return DAYS[weekday] ?? '';
}

/**
 * Is the place open, right now, in the city's own time?
 *
 * Two rules the naive version gets wrong. `closes < opens` means the row runs
 * past midnight, which is most bars, so Friday 20:00-02:00 is still open at
 * one on Saturday morning. And when there is no row for a weekday the place
 * is closed rather than unknown.
 *
 * `null` means we genuinely do not know, and the caller must then show plain
 * hours rather than guess. A wrong "Open" sends somebody across a city.
 */
export function isOpenNow(hours: BusinessHourJson[], now: Date): boolean | null {
  if (hours.length === 0) {
    return null;
  }
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const yesterday = (day + 6) % 7;

  for (const row of hours) {
    const opens = minutesOf(row.opens);
    const closes = minutesOf(row.closes);
    if (closes > opens) {
      if (row.weekday === day && minutes >= opens && minutes < closes) {
        return true;
      }
    } else {
      // Runs past midnight: tonight after opening, or this morning before
      // yesterday's closing time.
      if (row.weekday === day && minutes >= opens) {
        return true;
      }
      if (row.weekday === yesterday && minutes < closes) {
        return true;
      }
    }
  }
  return false;
}

/** "Open · till 2:00", or just the hours when we cannot be sure. */
export function openLine(hours: BusinessHourJson[], now: Date): string | null {
  const open = isOpenNow(hours, now);
  if (open == null) {
    return null;
  }
  const day = now.getDay();
  const todays = hours.filter((h) => h.weekday === day);
  if (!open) {
    const next = todays[0];
    return next ? `Closed · opens ${shortTime(next.opens)}` : 'Closed today';
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  const current =
    todays.find((h) => {
      const opens = minutesOf(h.opens);
      const closes = minutesOf(h.closes);
      return closes > opens ? minutes >= opens && minutes < closes : minutes >= opens;
    }) ?? todays[0];
  return current ? `Open · till ${shortTime(current.closes)}` : 'Open';
}

/**
 * Where a new place sits in your own list, as a binary search over the
 * comparisons you have already answered.
 *
 * `lo`/`hi` bound the window inside the bucket; the midpoint is what gets sent
 * to the server, which validates the range and derives the score. Fewer than
 * two places already rated in this bucket and there is nothing to compare
 * against, so the bucket alone sets the score at its middle.
 */
export type Comparison = { lo: number; hi: number; against: MyRatingRow | null };

export function startComparison(bucket: RatingBucket, mine: MyRatingRow[]): Comparison {
  const inBucket = mine.filter((row) => row.bucket === bucket);
  return { lo: 0, hi: 1, against: pickMiddle(inBucket, 0, 1) };
}

/** Three or four of these and the window is small enough to stop. */
export function answerComparison(
  current: Comparison,
  bucket: RatingBucket,
  mine: MyRatingRow[],
  preferredNew: boolean
): Comparison {
  const inBucket = mine.filter((row) => row.bucket === bucket);
  const mid = midpointOf(current.against, inBucket, current.lo, current.hi);
  const next = preferredNew ? { lo: mid, hi: current.hi } : { lo: current.lo, hi: mid };
  return { ...next, against: pickMiddle(inBucket, next.lo, next.hi) };
}

export function comparisonRank(current: Comparison): number {
  return (current.lo + current.hi) / 2;
}

/** Stop once the window is tight, or once there is nothing left to ask about. */
export function comparisonsDone(current: Comparison, asked: number): boolean {
  return current.against == null || asked >= 4 || current.hi - current.lo < 0.1;
}

function rankOf(row: MyRatingRow, inBucket: MyRatingRow[]): number {
  const index = inBucket.findIndex((r) => r.business_id === row.business_id);
  return inBucket.length <= 1 ? 0.5 : 1 - index / (inBucket.length - 1);
}

function midpointOf(
  against: MyRatingRow | null,
  inBucket: MyRatingRow[],
  lo: number,
  hi: number
): number {
  return against ? rankOf(against, inBucket) : (lo + hi) / 2;
}

/** The place nearest the middle of the current window, or null when empty. */
function pickMiddle(inBucket: MyRatingRow[], lo: number, hi: number): MyRatingRow | null {
  const inside = inBucket.filter((row) => {
    const rank = rankOf(row, inBucket);
    return rank > lo && rank < hi;
  });
  if (inside.length === 0) {
    return null;
  }
  const target = (lo + hi) / 2;
  return inside.reduce((best, row) =>
    Math.abs(rankOf(row, inBucket) - target) < Math.abs(rankOf(best, inBucket) - target)
      ? row
      : best
  );
}
