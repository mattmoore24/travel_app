import { destructiveIndex, travelerMenuItems } from '@/features/profile/actions-menu';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

/**
 * The three things you can do about a stranger, identical on every surface
 * that offers them.
 *
 * They used to be written out separately in the chat header and on a
 * stranger's profile, and not at all on Travelers - the screen where a
 * creepy bio is actually first read. This pins the labels and, more
 * importantly, which single row iOS paints red: findIndex returns the FIRST
 * destructive item, and a thread's sheet carries a second one ("Leave chat")
 * right after it.
 */
describe('the traveler actions sheet', () => {
  const onBlock = jest.fn();

  it('offers the profile, the report and the block, in that order', () => {
    const items = travelerMenuItems({ userId: 'u1', context: 'travelers', onBlock });
    expect(items.map((item) => item.label)).toEqual(['View profile', 'Report', 'Block']);
    expect(destructiveIndex(items)).toBe(2);
  });

  it('drops View profile for a business reader, and keeps its own tail', () => {
    // /profile/[userId] sits behind `signedIn && onboarded`, which a business
    // account never satisfies, so the row was a tap that did nothing at all.
    const items = travelerMenuItems({
      userId: 'u1',
      context: 'chat:c1',
      canViewProfile: false,
      onBlock,
      extra: [{ label: 'Archive', run: jest.fn() }],
    });
    expect(items.map((item) => item.label)).toEqual(['Report', 'Block', 'Archive']);
    expect(destructiveIndex(items)).toBe(1);
  });

  it('paints the block red, never the leave', () => {
    const items = travelerMenuItems({
      userId: 'u1',
      context: 'chat:c1',
      onBlock,
      extra: [{ label: 'Leave chat', destructive: true, run: jest.fn() }],
    });
    expect(items.map((item) => item.label)).toEqual([
      'View profile',
      'Report',
      'Block',
      'Leave chat',
    ]);
    expect(items[destructiveIndex(items)].label).toBe('Block');
  });

  it('hands the block back to the caller rather than confirming it here', () => {
    // What a block promises differs by surface, and a business is promised
    // less than a traveler because it has no map pin and no Travelers tab.
    const spy = jest.fn();
    const items = travelerMenuItems({ userId: 'u1', context: 'profile', onBlock: spy });
    items[destructiveIndex(items)].run();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('says none of the banned words and carries no em dash', () => {
    const items = travelerMenuItems({ userId: 'u1', context: 'travelers', onBlock });
    for (const { label } of items) {
      expect(label).not.toContain('—');
      expect(label).not.toMatch(/\b(swipe|deck|match|request)\b/i);
    }
  });
});
