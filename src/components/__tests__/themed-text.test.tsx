import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { FontCap, Type } from '@/constants/theme';

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

/**
 * Display and title stop at FontCap.heading on their own; nothing else is
 * capped by default. Reading text scales without limit here, and a heading
 * is the one role where the largest accessibility size turns a two-word
 * title into the whole screen.
 */
describe('ThemedText caps the two heading roles and nothing else', () => {
  it.each(['display', 'title'] as const)('%s takes FontCap.heading by default', (type) => {
    render(<ThemedText type={type}>x</ThemedText>);
    expect(screen.getByText('x').props.maxFontSizeMultiplier).toBe(FontCap.heading);
  });

  it.each(['headline', 'body', 'callout', 'footnote', 'caption', 'default', 'small'] as const)(
    '%s scales without limit',
    (type) => {
      render(<ThemedText type={type}>x</ThemedText>);
      expect(screen.getByText('x').props.maxFontSizeMultiplier).toBeUndefined();
    }
  );

  it('lets a caller set its own cap, including none at all', () => {
    render(
      <ThemedText type="display" maxFontSizeMultiplier={1.2}>
        a
      </ThemedText>
    );
    expect(screen.getByText('a').props.maxFontSizeMultiplier).toBe(1.2);
    // 0 is React Native's "no maximum"; `??` must leave it alone.
    render(
      <ThemedText type="title" maxFontSizeMultiplier={0}>
        b
      </ThemedText>
    );
    expect(screen.getByText('b').props.maxFontSizeMultiplier).toBe(0);
  });
});
