import { AccessibilitySizesFrom, FontCap } from '@/constants/theme';

/**
 * The line where the app changes a layout for the text size is Apple's own
 * category line, pinned in the units React Native reports: body size over
 * 17. xxxLarge (23pt) is the largest standard size and AX1 (28pt) the first
 * accessibility size, so the constant has to sit strictly between them to
 * select exactly the five accessibility sizes. A "tidy" edit to 1.5 or 1.7
 * would move the line onto a standard size or off the first accessibility
 * one; this test is what refuses that.
 */
describe('AccessibilitySizesFrom', () => {
  it('sits between xxxLarge (23/17) and AX1 (28/17), so it selects exactly the accessibility sizes', () => {
    expect(AccessibilitySizesFrom).toBeGreaterThan(23 / 17);
    expect(AccessibilitySizesFrom).toBeLessThanOrEqual(28 / 17);
  });

  it('is a layout line, not a text cap: it is not one of the caps', () => {
    expect(Object.values(FontCap)).not.toContain(AccessibilitySizesFrom);
  });
});
