import { between, source } from '@/lib/__tests__/source';

/**
 * A section heading and its reply chip share a row. At the accessibility
 * sizes the chip is half the row wide, and a title given only what the chip
 * left wrapped one letter to a line: "Trave / l / plans" on the stranger's
 * profile at AX5 (E2E run 140). The title keeps half the row and the chip
 * wraps beneath it instead.
 */
describe('a profile section heading at large text', () => {
  const code = source('src/features/profile/profile-view.tsx');

  it('lets the reply chip wrap under the title rather than squeezing it', () => {
    const header = between(code, 'sectionHeader: {', '},');
    expect(header).toContain("flexWrap: 'wrap'");
    const title = between(code, 'sectionTitle: {', '},');
    expect(title).toContain("minWidth: '50%'");
    expect(title).toContain('flexShrink: 1');
    expect(title).not.toContain('flex: 1,');
  });
});
