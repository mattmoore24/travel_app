import { between, source } from '@/lib/__tests__/source';

/**
 * A row holding a TextInput is a floor, never a fixed height.
 *
 * The input's line scales with Dynamic Type and a box around it does not,
 * so at the accessibility sizes three rows in the app clipped their own
 * caret and descenders: the place-mode search, the languages picker's
 * search, and the social handle editor's input. Each is `minHeight` plus a
 * little vertical padding now, which is what the fixed box used to give the
 * line for free at the default size.
 */
const ROWS: [file: string, style: string][] = [
  ['src/features/pins/pin-search-field.tsx', '  row: {'],
  ['src/components/form/language-field.tsx', '  searchRow: {'],
  ['src/features/profile/social-handles-editor.tsx', '  inputRow: {'],
];

describe.each(ROWS)('%s', (file, style) => {
  const block = between(source(file), style, '  },');

  it('has no fixed height', () => {
    expect(block).not.toMatch(/^\s+height:/m);
  });

  it('floors at the hit target and pads the line', () => {
    expect(block).toMatch(/minHeight: HitTarget/);
    expect(block).toContain('paddingVertical: Space.xs');
  });
});
