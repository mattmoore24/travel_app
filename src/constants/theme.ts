/**
 * Design tokens. Nothing in the app hardcodes a hex, a font size, or a magic
 * number — see docs/DESIGN.md for the reasoning behind each scale.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * "Dusk": deep indigo + burnt amber on a warm bone canvas — the light when you
 * land somewhere, which is also when travellers actually make plans.
 *
 * Indigo replaced the earlier trail green for a concrete reason: green accents
 * sit close to Apple Maps' park polygons, and the map is the hero screen. A
 * cool primary separates from the beige-and-green basemap; the warm canvas and
 * amber keep it from reading cold. Still nothing like the red/pink/purple every
 * dating app runs.
 *
 * Every pair below clears WCAG 4.5:1 in both schemes (3:1 for purely graphical
 * marks) — verified numerically, not by eye. Amber is deliberately the deep
 * ochre rather than a bright one: a brighter amber cannot carry white text and
 * loses to a beige basemap.
 */
export const Colors = {
  light: {
    canvas: '#FBFAF7',
    surface: '#FFFFFF',
    surfaceSunken: '#F0EFEA',
    // Warm ink rather than a cool near-black: type sits on a warm canvas,
    // and the 2026 direction for community products is warmth throughout.
    text: '#211E1A',
    textSecondary: '#585F6B',
    accent: '#2A4C9B',
    onAccent: '#FFFFFF',
    accentSoft: '#E7EBF8',
    /** Second brand colour: featured badges, own-pin, unread marks. */
    highlight: '#9A5709',
    onHighlight: '#FFFFFF',
    highlightSoft: '#FBEEDA',
    // Same value as `highlight` today — kept as its own token so the semantic
    // and brand roles can diverge without a refactor.
    warning: '#9A5709',
    danger: '#B5342A',
    hairline: 'rgba(0,0,0,0.07)',
    scrim: 'rgba(10,12,18,0.32)',

    // Legacy aliases — kept so un-migrated screens keep compiling while the
    // redesign lands screen by screen. Remove when the last one is gone.
    background: '#FBFAF7',
    backgroundElement: '#F0EFEA',
    backgroundSelected: '#E7EBF8',
    tint: '#2A4C9B',
    onTint: '#FFFFFF',
  },
  dark: {
    canvas: '#0D0F14',
    surface: '#171A21',
    surfaceSunken: '#212630',
    text: '#F4F4F2',
    textSecondary: '#A3AAB8',
    accent: '#8AA6F0',
    onAccent: '#0A1330',
    accentSoft: '#1D2742',
    highlight: '#F0A93C',
    onHighlight: '#2A1A00',
    highlightSoft: '#33260F',
    warning: '#F0A93C',
    danger: '#F08076',
    hairline: 'rgba(255,255,255,0.08)',
    scrim: 'rgba(0,0,0,0.45)',

    background: '#0D0F14',
    backgroundElement: '#212630',
    backgroundSelected: '#1D2742',
    tint: '#8AA6F0',
    onTint: '#0A1330',
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

/**
 * Reanimated spring presets — one vocabulary so every interaction shares a
 * physical feel (values from the motion research in docs/DESIGN.md).
 * `press`/`release` pair up in PressableScale; `sheet` is the iOS system
 * spring (SwiftUI response 0.55 / damping 0.825 converted); `snap` settles
 * without overshoot; `drop` lands with one crisp bounce; `pop` celebrates.
 */
export const Springs = {
  press: { damping: 30, stiffness: 500 },
  release: { damping: 15, stiffness: 350 },
  gentle: { damping: 22, stiffness: 220 },
  bouncy: { damping: 12, stiffness: 200 },
  sheet: { mass: 1, stiffness: 130, damping: 19 },
  snap: { duration: 350, dampingRatio: 0.92, overshootClamping: true },
  drop: { mass: 1, damping: 14, stiffness: 260 },
  pop: { duration: 550, dampingRatio: 0.75 },
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

export const BottomTabInset = Platform.select({ ios: 50, android: 80, web: 72 }) ?? 0;
export const MaxContentWidth = 800;
