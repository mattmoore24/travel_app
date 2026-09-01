import type {
  BusinessCategory,
  BusinessHourJson,
  BusinessLinkKind,
  BusinessReportReason,
  MyRatingRow,
  RatingBucket,
  RatingTag,
} from '@/lib/database.types';
import { clocks } from '@/lib/locale';
import { countOf, isAre } from '@/lib/plural';

/**
 * The words a traveler sees, in one place.
 *
 * Two vocabulary rules run through all of it.
 *
 * A commercial listing is a BUSINESS in every string anybody reads, traveler
 * or owner. This reverses the older rule, which had travelers only ever
 * seeing "place" - founder, 2026-08-28: "I don't think we should refer to
 * businesses as places, we should always call them businesses to keep it
 * consistent and also less confusing." The word "place" survives only where
 * it means a spot on the map, as in the drop-a-pin search field.
 *
 * And nothing is ever called a "pin": that word is load-bearing in §7 rule 3,
 * where it means a traveler's 72-hour marker, and a permanent commercial
 * listing borrowing it would blur the one distinction the rule exists to
 * draw.
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
  other: 'Something else',
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

/**
 * The two conduct reasons lead, and the four map corrections follow.
 *
 * The order is the triage order the person reading it walks down, and the
 * traveler report form settled the same argument the same way: a list that
 * puts "It's in the wrong spot" above "It felt unsafe" has said something
 * about which of the two this app takes seriously. The spec asked only that
 * these two sit above "Spam or something offensive"; leading with them
 * satisfies that and matches REASON_OPTIONS in app/report.tsx.
 *
 * "Somebody here" is locative, about the venue, and not a presence claim: it
 * means the people at that bar, on a form that is already about that one
 * business.
 */
export const REPORT_REASONS: { value: BusinessReportReason; label: string }[] = [
  { value: 'harassment_or_conduct', label: 'Somebody here treated me badly' },
  { value: 'unsafe', label: 'It felt unsafe' },
  { value: 'not_this_business', label: "This isn't the real business" },
  { value: 'not_a_real_place', label: "It doesn't exist" },
  { value: 'permanently_closed', label: "It's closed for good" },
  { value: 'wrong_location', label: "It's in the wrong spot" },
  { value: 'spam_or_offensive', label: 'Spam or something offensive' },
];

/**
 * The reasons that are about the people rather than about the pin.
 *
 * The database asks the same question from the other end (anything that is
 * not one of the five listing-accuracy reasons), because a migration cannot
 * name an enum label it added in the same transaction. Here there is no such
 * constraint, so the list says plainly which two it means.
 */
export const CONDUCT_REPORT_REASONS: BusinessReportReason[] = ['harassment_or_conduct', 'unsafe'];

/** Whether this report is about how a business behaved. */
export function isConductReason(reason: BusinessReportReason | null): boolean {
  return reason != null && CONDUCT_REPORT_REASONS.includes(reason);
}

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

/** A moment, on the reader's own clock: '21:14', or '9:14 PM'. */
export function clockTime(at: Date): string {
  return clocks().instant.format(at);
}

/**
 * '18:00:00' -> '18:00', or '6:00 PM'. Seconds are never useful to a person.
 *
 * The hours a business keeps are its own and absolute — this does not shift
 * them into anybody's timezone, and `openLine` below is what decides whether
 * they mean open. All that changes here is how the same two numbers are read
 * aloud, which is the reader's business and not the venue's.
 */
export function shortTime(time: string): string {
  const [rawHour, rawMinute] = time.split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return time.slice(0, 5);
  }
  return clocks().wall.format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

export function weekdayLabel(weekday: number): string {
  return DAYS[weekday] ?? '';
}

/**
 * The place's own wall clock, approximated from its longitude.
 *
 * The device's clock is the wrong one. Somebody in Lisbon reading a Bangkok
 * bar's hours would be told "Open" against Lisbon time, seven hours out, and
 * the plan is explicit that a wrong "Open" is worse than no answer because it
 * sends somebody across a city.
 *
 * `cities` carries no timezone column, so longitude does the work: fifteen
 * degrees an hour. That is exact for a place sitting on its meridian and off
 * by up to an hour where a political timezone is stretched, plus another hour
 * wherever daylight saving is in force. An hour of error at a closing time is
 * a real but bounded problem; seven hours is not. Adding a real timezone to
 * `cities` (GeoNames publishes one) is the proper fix and is a migration, not
 * a client change.
 */
export function cityNow(now: Date, lng: number | null): Date {
  if (lng == null) {
    return now;
  }
  const offsetMinutes = Math.round((lng / 15) * 60);
  return new Date(now.getTime() + (now.getTimezoneOffset() + offsetMinutes) * 60_000);
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

/**
 * "Open · till 2:00", or just the hours when we cannot be sure.
 *
 * Pass the place's longitude and the answer is about its clock rather than
 * the reader's. Without it the reader's clock is used, which is only right
 * for somebody already in the city.
 */
export function openLine(
  hours: BusinessHourJson[],
  clock: Date,
  lng: number | null = null
): string | null {
  const now = cityNow(clock, lng);
  const open = isOpenNow(hours, now);
  if (open == null) {
    return null;
  }
  const day = now.getDay();
  const todays = hours.filter((h) => h.weekday === day);
  if (!open) {
    // The next opening, not the first row of the day. A restaurant that runs
    // 09:00-14:00 and 18:00-23:00 read "Closed · opens 09:00" at four in the
    // afternoon, which somebody sensibly takes to mean "shut for the day"
    // rather than "back in two hours".
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const upcoming = todays
      .filter((h) => minutesOf(h.opens) > minutesNow)
      .sort((a, b) => minutesOf(a.opens) - minutesOf(b.opens))[0];
    const next = upcoming ?? todays[0];
    return next
      ? upcoming
        ? `Closed · opens ${shortTime(next.opens)}`
        : `Closed · opens ${shortTime(next.opens)} tomorrow`
      : 'Closed today';
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
 * One line for the composer: the answer may wait, because the door is shut.
 *
 * Inherits openLine's caution exactly. `isOpenNow` returning null means we
 * genuinely do not know, and the note must say nothing at all rather than
 * default to "closed" - otherwise every business with no hours filled in
 * tells travelers it is shut. And it promises no time: the city clock is
 * approximate (see cityNow), so "when they open" is the strongest claim the
 * app can keep.
 */
export function waitNote(
  hours: BusinessHourJson[],
  clock: Date,
  lng: number | null = null
): string | null {
  const open = isOpenNow(hours, cityNow(clock, lng));
  if (open !== false) {
    return null;
  }
  return 'Closed right now. They will probably answer when they open.';
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

/**
 * The "How it's going" line on My business: what came back from the world
 * this week, in one sentence.
 *
 * My business is otherwise five sections of what the owner typed in
 * themselves, and the one signal from outside — the rating — renders nothing
 * until five travelers have rated. So an owner who signed up on Monday has
 * no reason to open the app on Tuesday, and §6 wants liquidity legible from
 * day one.
 *
 * WHAT THIS DELIBERATELY IS NOT
 * -----------------------------
 * Founder ruling, this batch: one sentence from numbers already on the
 * screen. Not a counter, not a chart, not a time series, and no new table —
 * the moment it needs one it has stopped being this package and become the
 * views/taps/saves product §10 defers.
 *
 * It counts CONVERSATIONS, never senders, and names nobody. Which travelers
 * wrote and which rated is the anti-retaliation control the rating block
 * already records; a "how it's going" line that leaked a name beside it
 * would undo that control from one section away.
 */
export function weekLine({
  chatsThisWeek,
  memberCount,
}: {
  /** Conversations a traveler opened with this business in the last 7 days. */
  chatsThisWeek: number;
  /** Travelers currently in the business's own chat room. */
  memberCount: number;
}): string {
  if (chatsThisWeek > 0) {
    // "started a conversation", not "wrote to you". countChatsSince counts
    // rows by created_at, which is when the CHAT was opened - so a traveler
    // who wrote again in a thread from last month is not in this number, and
    // "wrote to you this week" would have been a claim the number does not
    // support. Counting new conversations is the honest reading of the data
    // that exists, and it is also the more useful one: it is the thing that
    // grows when a listing starts working.
    const wrote = `${countOf(chatsThisWeek, 'traveler')} started a conversation this week.`;
    return memberCount > 0
      ? `${wrote} ${countOf(memberCount, 'traveler')} ${isAre(memberCount)} in your chat.`
      : wrote;
  }
  if (memberCount > 0) {
    return `${countOf(memberCount, 'traveler')} ${isAre(memberCount)} in your chat. No new conversations this week.`;
  }
  // The floor, said as a fact and not as a failure. Photos and hours are what
  // move a listing up the map, which is what the section below is for.
  return 'No new conversations this week. A listing with photos and hours gets read more.';
}

/**
 * How many conversations a traveler opened with this business inside seven
 * days of `now`.
 *
 * Pure, and takes the clock as an argument, so the screen reads it once per
 * data change (the shape openLine already set) instead of once per render —
 * a count that moves under a re-render is how a number on a dashboard stops
 * being believable.
 *
 * `kind === 'business'` is the whole filter: my_chats hands an owner one such
 * row per traveler who wrote in, plus their own room, which is a different
 * kind. So this counts inbound conversations and nothing else.
 */
export function countChatsSince(
  rows: { kind: string; created_at: string }[] | null,
  now: Date
): number {
  if (rows == null) {
    return 0;
  }
  const since = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return rows.filter((row) => row.kind === 'business' && Date.parse(row.created_at) >= since)
    .length;
}

/** How many of the five things a listing is judged on are filled in. */
export function detailsDone({
  hasAddress,
  photos,
  hasHours,
  hasDescription,
  links,
}: {
  hasAddress: boolean;
  photos: number;
  hasHours: boolean;
  hasDescription: boolean;
  links: number;
}): number {
  return [hasAddress, photos > 0, hasHours, hasDescription, links > 0].filter(Boolean).length;
}
