import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor, Type, type TypeRole } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Legacy role names, mapped onto the design-system scale so screens that
 * haven't been redesigned yet still pick up the new typography. New code uses
 * the `Type` roles directly (`display`, `title`, `headline`, …).
 */
const LEGACY: Record<string, TypeRole> = {
  default: 'body',
  title: 'display',
  subtitle: 'title',
  small: 'footnote',
  smallBold: 'callout',
  link: 'callout',
  linkPrimary: 'callout',
  code: 'footnote',
};

export type ThemedTextProps = TextProps & {
  type?:
    TypeRole | 'default' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const role: TypeRole = (LEGACY[type] ?? type) as TypeRole;

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
