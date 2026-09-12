import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { FontCap, Fonts, ThemeColor, Type, type TypeRole } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Legacy role names, mapped onto the design-system scale so screens that
 * haven't been redesigned yet still pick up the new typography. New code uses
 * the `Type` roles directly (`display`, `title`, `headline`, …).
 *
 * `title` and `subtitle` are gone from this map ON PURPOSE: `title` used to
 * shadow the real 24pt `title` role with 32pt `display`, so a contributor
 * reading theme.ts and writing `type="title"` got something a third larger
 * than the table says, with no error — and the documented 24pt role was
 * unreachable by its own name. Every call site now names the role it wants;
 * `__tests__/themed-text.test.tsx` pins each name to its size so the
 * shadowing cannot come back silently.
 */
const LEGACY: Record<string, TypeRole> = {
  default: 'body',
  small: 'footnote',
  smallBold: 'callout',
  link: 'callout',
  linkPrimary: 'callout',
  code: 'footnote',
};

export type ThemedTextProps = TextProps & {
  type?: TypeRole | 'default' | 'small' | 'smallBold' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({
  style,
  type = 'body',
  themeColor,
  maxFontSizeMultiplier,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  const role: TypeRole = (LEGACY[type] ?? type) as TypeRole;

  // The two heading roles stop at FontCap.heading unless the caller says
  // otherwise; every other role scales without limit (see FontCap for the
  // rule). A 32pt display at the largest accessibility size is 100pt, which
  // is a screen title that IS the screen, and a name in the profile hero
  // that pushes the trips under the fold. Pass 0 to lift the cap on one
  // heading; `??` leaves an explicit 0 alone.
  const cap =
    maxFontSizeMultiplier ?? (role === 'display' || role === 'title' ? FontCap.heading : undefined);

  return (
    <Text
      style={[
        Type[role],
        { color: theme[themeColor ?? 'text'] },
        // A couple of legacy names carried meaning beyond size.
        type === 'smallBold' && styles.strong,
        type === 'linkPrimary' && { color: theme.accent },
        type === 'code' && styles.code,
        style,
      ]}
      maxFontSizeMultiplier={cap}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  strong: {
    fontWeight: '600',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: '700' }) ?? '500',
  },
});
