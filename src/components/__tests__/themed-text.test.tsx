import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { Type } from '@/constants/theme';

/**
 * Every role name the props union accepts resolves to exactly the size the
 * scale says. This exists because a LEGACY entry silently shadowed the real
 * `title` role with `display` for months: nineteen `type="title"` call sites
 * rendered at 32pt while theme.ts documented 24pt, with no error anywhere. A
 * contributor must be able to read the table in theme.ts and trust it.
 */

const CASES: [NonNullable<ThemedTextProps['type']>, number][] = [
  // The seven real roles, straight off the scale.
  ['display', Type.display.fontSize],
  ['title', Type.title.fontSize],
  ['headline', Type.headline.fontSize],
  ['body', Type.body.fontSize],
  ['callout', Type.callout.fontSize],
  ['footnote', Type.footnote.fontSize],
  ['caption', Type.caption.fontSize],
  // The surviving legacy aliases, each mapped to a role of the SAME size —
  // an alias may rename, it may never resize.
  ['default', Type.body.fontSize],
  ['small', Type.footnote.fontSize],
  ['smallBold', Type.callout.fontSize],
  ['link', Type.callout.fontSize],
  ['linkPrimary', Type.callout.fontSize],
  ['code', Type.footnote.fontSize],
];

describe('ThemedText resolves every accepted type name to its documented size', () => {
  it.each(CASES)('type="%s" renders at %dpt', (type, fontSize) => {
    render(<ThemedText type={type}>x</ThemedText>);
    const flat = StyleSheet.flatten(screen.getByText('x').props.style);
    expect(flat.fontSize).toBe(fontSize);
  });

  it('title is the real 24pt role, one full step below display', () => {
    // The exact shadowing that shipped: title resolving to display's size.
    expect(Type.title.fontSize).toBeLessThan(Type.display.fontSize);
    render(<ThemedText type="title">t</ThemedText>);
    const flat = StyleSheet.flatten(screen.getByText('t').props.style);
    expect(flat.fontSize).toBe(24);
    expect(flat.fontSize).not.toBe(Type.display.fontSize);
  });
});
