import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { dates } from '@/lib/locale';

/**
 * When a group's chat closes, and how to say so.
 *
 * The founder's sentence is "the chat is active through that date and closes
 * the following day", and the database enforces exactly that:
 * `group_closes_at()` returns noon UTC on the day after `max_stay_until`.
 *
 * The noon is not arbitrary. "Active through the 10th" has to still be true at
 * 23:59 on the 10th wherever you are, and the last place on earth to finish
 * its 10th is UTC-12, at 11:59 UTC on the 11th. Noon UTC on the 11th is
 * therefore the earliest instant that is never early for anybody. It runs late
 * by up to a day at the far east of the map, which is the right direction to
 * be wrong in: a chat that lingers beats one that cuts somebody off on a day
 * the app told them was still theirs.
 *
 * Everything here derives from that INSTANT rather than from the date string,
 * which is what keeps the printed day honest east of UTC+12 — there, the
 * calendar day after `max_stay_until` has already passed by the time the chat
 * actually closes, and printing it would name a day the members can disprove
 * from their own scrollback.
 */

/** Null means no end date: this chat never closes. */
export function groupClosesAt(maxStayUntil: string | null): Date | null {
  if (maxStayUntil == null) {
    return null;
  }
  const [y, m, d] = maxStayUntil.split('-').map(Number);
  // Date.UTC rolls the month over for us, so the 31st of a 31-day month gives
  // the 1st of the next one rather than a 32nd.
  return new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0, 0));
}

export function hasGroupClosed(maxStayUntil: string | null, now: Date = new Date()): boolean {
  const at = groupClosesAt(maxStayUntil);
  return at != null && now.getTime() >= at.getTime();
}

/**
 * "Sep 12" — the day it actually closed, in the reader's own timezone.
 *
 * The ZONE is the reader's (lib/locale's formatters carry no timeZone, so
 * they read the instant in the device's), and the WORDS are the app's: this
 * used to pass `undefined` as the locale, which is the device's language, and
 * was one of the four sites drawing Portuguese beside English rows.
 */
export function closeDayLabel(maxStayUntil: string | null): string | null {
  const at = groupClosesAt(maxStayUntil);
  return at == null ? null : dates().monthDay.format(at);
}

/**
 * Whether the chat is closed, kept current while somebody is looking at it.
 *
 * Computing it once at render is not enough in either direction. Somebody
 * sitting in a chat at its closing moment would keep a live composer over a
 * policy that has started refusing, and somebody opening a phone that slept
 * through the close would see the same. So: a timer for the exact moment when
 * that is in range, plus a re-check whenever the app comes back to the
 * foreground, because a sleeping phone fires no timers.
 */
export function useHasGroupClosed(maxStayUntil: string | null): boolean {
  const [closed, setClosed] = useState(() => hasGroupClosed(maxStayUntil));

  // Re-derived during render when the date changes — the sanctioned "storing
  // information from previous renders" pattern, and the same one
  // useMarkerTracking uses. Setting it inside the effect instead would be a
  // synchronous set on every mount, which is both a wasted second render and
  // the thing react-hooks/set-state-in-effect exists to catch.
  const [prevDate, setPrevDate] = useState(maxStayUntil);
  if (prevDate !== maxStayUntil) {
    setPrevDate(maxStayUntil);
    setClosed(hasGroupClosed(maxStayUntil));
  }

  useEffect(() => {
    const at = groupClosesAt(maxStayUntil);
    const check = () => setClosed(hasGroupClosed(maxStayUntil));

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        check();
      }
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (at != null) {
      const ms = at.getTime() - Date.now();
      // setTimeout clamps above 2^31-1 ms and would fire immediately, so a
      // close more than ~24 days out is left to the foreground check.
      if (ms > 0 && ms < 2 ** 31 - 1) {
        timer = setTimeout(check, ms);
      }
    }

    return () => {
      subscription.remove();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [maxStayUntil]);

  return closed;
}

/**
 * A date the server may have sent as `'infinity'`.
 *
 * `room_members.expires_at` is NOT NULL, so the admin of a no-end-date group
 * holds an infinite seat, and PostgREST serialises that as the literal string
 * "infinity". It is truthy, so a plain `x ? new Date(x) : null` guard sails
 * past it and renders "you leave Invalid Date".
 */
export function finiteDate(iso: string | null): Date | null {
  if (iso == null) {
    return null;
  }
  const at = new Date(iso);
  return Number.isFinite(at.getTime()) ? at : null;
}
