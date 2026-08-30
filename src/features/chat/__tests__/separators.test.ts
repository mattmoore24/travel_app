import { rowTimestamp, separatorFor, unreadLabel } from '@/features/chat/separators';
import type { MessageRow } from '@/lib/database.types';

function at(date: Date): MessageRow {
  return {
    id: date.toISOString(),
    chat_id: 'c',
    sender_id: 's',
    body: 'hi',
    image_path: null,
    created_at: date.toISOString(),
  };
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('separatorFor', () => {
  it('stamps the oldest message with its day and time', () => {
    const now = new Date();
    expect(separatorFor(at(now), undefined)).toMatch(/^Today /);
  });

  it('says nothing between messages minutes apart', () => {
    const now = new Date();
    const older = at(new Date(now.getTime() - 3 * MINUTE));
    expect(separatorFor(at(now), older)).toBeNull();
  });

  it('shows the time alone after a long gap on the same day', () => {
    // Anchored at midday so the arithmetic cannot cross midnight.
    const midday = new Date();
    midday.setHours(12, 0, 0, 0);
    const older = at(new Date(midday.getTime() - 2 * HOUR));
    const label = separatorFor(at(midday), older);
    expect(label).not.toBeNull();
    expect(label).not.toMatch(/Today|Yesterday/);
  });

  it('names the day when the day changed, even minutes apart', () => {
    const justAfterMidnight = new Date();
    justAfterMidnight.setHours(0, 5, 0, 0);
    const older = at(new Date(justAfterMidnight.getTime() - 10 * MINUTE));
    expect(separatorFor(at(justAfterMidnight), older)).toMatch(/^Today /);
  });
});

describe('rowTimestamp', () => {
  it('shows the time for something that happened today', () => {
    const now = new Date();
    const at = new Date(now.getTime() - 2 * MINUTE);
    // Not asserting the exact string: the locale decides between "3:04 PM"
    // and "15:04". What matters is that it is a clock time, not a date.
    expect(rowTimestamp(at.toISOString(), now)).toMatch(/\d/);
    expect(rowTimestamp(at.toISOString(), now)).not.toBe('Yesterday');
  });

  it('names yesterday rather than dating it', () => {
    const now = new Date();
    const at = new Date(now.getTime() - 26 * HOUR);
    expect(rowTimestamp(at.toISOString(), now)).toBe('Yesterday');
  });

  it('uses the weekday inside the last week', () => {
    const now = new Date();
    const at = new Date(now.getTime() - 4 * 24 * HOUR);
    expect(rowTimestamp(at.toISOString(), now)).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  });

  it('falls back to a worded date beyond a week, never a numeric one', () => {
    // The exact string, not a wildcard: '3/4' means March 4 to an American
    // and 3 April to nearly everyone else the app is for. Both dates are
    // built in local time so the assertion holds in any timezone.
    const now = new Date(2026, 7, 30, 12, 0, 0);
    const at = new Date(2026, 2, 4, 12, 0, 0);
    expect(rowTimestamp(at.toISOString(), now)).toBe('Mar 4');
  });

  it('renders nothing at all for a chat with no messages', () => {
    expect(rowTimestamp(null)).toBe('');
    expect(rowTimestamp('not a date')).toBe('');
  });
});

describe('unreadLabel', () => {
  it('counts up to 99 exactly', () => {
    expect(unreadLabel(1)).toBe('1');
    expect(unreadLabel(99)).toBe('99');
  });

  it('stops widening past 99', () => {
    expect(unreadLabel(100)).toBe('99+');
    expect(unreadLabel(4821)).toBe('99+');
  });
});
