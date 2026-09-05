import { dates } from '@/lib/locale';

/** What the account gate is showing. Not routes: there is no router there. */
export type GateView = 'gate' | 'rules' | 'appeal';

/**
 * "Sep 8", or "Jan 3, 2027" once the pause runs past the year. Through
 * lib/locale, because this used to be a bare `toLocaleDateString()`: the
 * device's language AND the numeric shape lib/locale deliberately does not
 * offer, so an American read "9/8/2026" and everybody else read 8 September
 * as a date in the ninth month of the eighth year.
 */
function pausedUntil(until: Date): string {
  return until.getFullYear() === new Date().getFullYear()
    ? dates().monthDay.format(until)
    : dates().monthDayYear.format(until);
}

/**
 * The headline, the sentence under it, and the first line of an appeal, for
 * one account standing.
 *
 * Its own module rather than a function inside src/app/_layout.tsx, so the
 * words can be read by a test without mounting a navigator, a push handler
 * and a query client.
 *
 * Two agreements it has to keep. The titles are the titles of the pushes the
 * person got a second earlier
 * (supabase/migrations/20260901130000_a_notice_says_where_to_go.sql): two
 * different names for the same event reads as two separate events. And the
 * 30-day answer is the one docs/legal/COMMUNITY_GUIDELINES.md and
 * docs/legal/PRIVACY_POLICY.md both promise, so the app must not offer a
 * faster or a vaguer one.
 */
export function gateCopy(
  status: string,
  suspendedUntil: string | null
): { title: string; body: string; appeal: string } {
  const until = suspendedUntil ? new Date(suspendedUntil) : null;
  if (status === 'suspended') {
    return {
      title: 'Account paused',
      body:
        `Your account is paused${until ? ` until ${pausedUntil(until)}` : ''} for ` +
        'breaking our house rules. If you think that is wrong, tap Appeal this. ' +
        'A person reads it, not a log, and we answer within 30 days.',
      appeal: 'Appeal: account paused',
    };
  }
  return {
    title: 'Account closed',
    body:
      'Your account is closed for repeatedly breaking our house rules. If you think that is ' +
      'wrong, tap Appeal this. A person reads it, not a log, and we answer within 30 days.',
    appeal: 'Appeal: account closed',
  };
}
