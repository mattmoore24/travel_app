import { separatorFor } from '@/features/chat/separators';
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
