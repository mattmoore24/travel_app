/**
 * Design tokens. Nothing in the app hardcodes a hex, a font size, or a magic
 * number — see docs/DESIGN.md for the reasoning behind each scale.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Trail green + warm neutrals. Deliberately distinct from every dating app
 * (which run red/pink/purple) and legible on Apple Maps' beige-green canvas.
 * `textSecondary` clears 4.5:1 on `canvas` in both schemes.
 */
export const Colors = {
  light: {
    canvas: '#FBFAF7',
    surface: '#FFFFFF',
    surfaceSunken: '#F1EFEA',
    text: '#14171A',
    textSecondary: '#5C6360',
    accent: '#17795E',
    onAccent: '#FFFFFF',
    accentSoft: '#E4F1EB',
    warning: '#B4670E',
    danger: '#C0362B',
    hairline: 'rgba(0,0,0,0.07)',
    scrim: 'rgba(12,14,13,0.32)',

    // Legacy aliases — kept so un-migrated screens keep compiling while the
    // redesign lands screen by screen. Remove when the last one is gone.
    background: '#FBFAF7',
    backgroundElement: '#F1EFEA',
    backgroundSelected: '#E4F1EB',
    tint: '#17795E',
    onTint: '#FFFFFF',
  },
  dark: {
    canvas: '#0E100F',
    surface: '#191C1B',
    surfaceSunken: '#232725',
    text: '#F5F3EF',
    textSecondary: '#A8AFAB',
    accent: '#38A987',
    onAccent: '#04120D',
    accentSoft: '#16302A',
    warning: '#E39A48',
    danger: '#F08076',
    hairline: 'rgba(255,255,255,0.08)',
    scrim: 'rgba(0,0,0,0.45)',

    background: '#0E100F',
    backgroundElement: '#232725',
    backgroundSelected: '#16302A',
    tint: '#38A987',
    onTint: '#04120D',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/**
 * Seven type roles, generous line height. Sizes are defaults — they scale with
 * Dynamic Type because nothing disables `allowFontScaling`.
 */
export const Type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  headline: { fontSize: 19, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.4 },
} as const;

export type TypeRole = keyof typeof Type;

/** 4pt grid. */
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const Radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Three levels, no more. Shadows are soft and low-contrast by design. */
export const Elevation = {
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  sheet: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;

export const Motion = {
  quick: 150,
  standard: 250,
  slow: 400,
} as const;

/** Minimum tappable area (Apple HIG). */
export const HitTarget = 44;

/**
 * Legacy spacing scale. New code uses `Space`; this stays until the last
 * un-migrated screen is redesigned.
 */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
