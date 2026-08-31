/**
 * Design tokens. Nothing in the app hardcodes a hex, a font size, or a magic
 * number — see docs/DESIGN.md for the reasoning behind each scale.
 */

import '@/global.css';

import { Platform } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';

/**
 * "Nocturne" — a traveler's map at night.
 *
 * The ground is the unlit city (deep ink-violet). Warm light is the signal:
 * an intent pin glowing, a lantern at a hostel door. Heat on the map reads as
 * that light getting MORE INTENSE (amber -> ember), never as a different hue.
 *
 * DARK ONLY, deliberately. Nocturne is a dark theme and the app is dark-first,
 * so both keys below hold the same palette rather than pretending a light
 * scheme exists. Every component already reads `Colors[scheme]`, so restoring
 * a light scheme later is a matter of filling `light` back in — nothing else
 * has to change.
 *
 * ACCENT — the brand blue, not Nocturne's orange, at the founder's direction.
 * The literal request was the blue in use today, #2A4C9B. That value cannot
 * be used for anything a person has to READ on this ground: it scores 2.34:1
 * against #0E1020, failing not just the 4.5:1 body-text floor but the 3:1
 * floor for large text and UI edges. Its dark-scheme sibling #8AA6F0 is the
 * same brand blue and scores 7.90:1, so that is the accent. #2A4C9B survives
 * as a FILL underneath white text (8.06:1), which is where it still works.
 *
 * Every pair below is computed, not eyeballed. Ratios are against
 * `background` unless noted. Do not substitute a colour without re-checking.
 */
const nocturne = {
  // Ground — the unlit map
  canvas: '#0E1020',
  surface: '#171A2E',
  /** Sheets, modals, popovers — the layer that floats above a card. */
  surfaceSunken: '#20243D',

  // Text
  text: '#F1F0F7', // 16.7:1
  textSecondary: '#A6A9C4', // 8.2:1
  /** 4.0:1 — large text and non-critical labels only, never body copy. */
  textTertiary: '#6E7196',

  // Lantern, in the brand's blue
  accent: '#8AA6F0', // 7.9:1
  accentPressed: '#6E8BD8', // 5.7:1
  onAccent: '#0E1020', // 7.9:1 on accent. White here would be illegible.
  /** Tinted ground for selected rows and soft chips; text sits at 13.1:1. */
  accentSoft: '#1D2742',
  /** The deep brand blue, usable only as a fill under white (8.1:1). */
  accentDeep: '#2A4C9B',
  /** White on accentDeep is 8.2:1. This is the sent-message bubble. */
  onAccentDeep: '#FFFFFF',

  // Warm light — map pins, own-pin, unread marks, heat. Kept warm on purpose:
  // a blue pin on a dark blue basemap is the same collision that pushed the
  // brand off green in the first place, just inverted.
  highlight: '#FF9A5A', // 9.0:1
  onHighlight: '#0E1020', // 9.0:1
  highlightSoft: '#33260F',
  /** Reserved for the heat scale's top end and rare high-emphasis moments. */
  ember: '#FF6B54', // 6.7:1

  // Semantic
  success: '#7FD9A8', // 11.1:1
  warning: '#FFC168', // 11.8:1
  danger: '#FF6B6B', // 6.8:1

  /** Decorative dividers only — deliberately below the functional floor. */
  hairline: '#2E3350',
  /** Input outlines and anything whose edge a user must see — 3.4:1. */
  border: '#5E6499',
  scrim: 'rgba(6,7,16,0.62)',

  // Legacy aliases, kept so un-migrated screens keep compiling.
  background: '#0E1020',
  backgroundElement: '#20243D',
  backgroundSelected: '#1D2742',
  tint: '#8AA6F0',
  onTint: '#0E1020',
} as const;

export const Colors = {
  light: nocturne,
  dark: nocturne,
} as const;

/**
 * What native controls should render as. Some UIKit components (the date
 * picker, keyboards) pick their own colours and have to be told, and they
 * cannot read our tokens — so this is the one honest place to say it.
 */
export const NativeAppearance = 'dark' as const;

/**
 * The splash field, mirrored from app.json's expo-splash-screen background.
 * Hardcoded rather than themed because the JS side has to match a native
 * screen that renders before any JS runs — if these two drift, the handoff
 * flashes. Change both together.
 */
export const SplashField = '#0E1020' as const;

/**
 * The deep brand blue, for static styles that need a FILL and cannot read a
 * theme (StyleSheet.create runs at module scope). Legible only under white
 * or near-white content: 8.1:1. Never put it behind body text on the app's
 * own dark ground, where it scores 2.3:1.
 */
export const BrandDeep = '#2A4C9B' as const;

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
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  headline: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
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
  /** The tail corner of a chat bubble. */
  xs: 5,
  /** Inputs and small chips. */
  sm: 8,
  /** Cards. */
  md: 12,
  /** Sheets and modals. */
  lg: 16,
  xl: 20,
  /** Chat bubbles: iMessage's corner, which is rounder than a card's. */
  bubble: 18,
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
  // `reduceMotion: ReduceMotion.System` on every preset: Reanimated then
  // skips the travel and lands each spring at its end value when the OS
  // Reduce Motion switch is on. Belt-and-braces (the library honours the
  // flag for withSpring by default) and the one place all eight presets can
  // promise it at once. It does NOT belong on `Motion` above - that is a
  // duration map whose values are passed straight through as numbers.
  press: { damping: 30, stiffness: 500, reduceMotion: ReduceMotion.System },
  release: { damping: 15, stiffness: 350, reduceMotion: ReduceMotion.System },
  gentle: { damping: 22, stiffness: 220, reduceMotion: ReduceMotion.System },
  bouncy: { damping: 12, stiffness: 200, reduceMotion: ReduceMotion.System },
  sheet: { mass: 1, stiffness: 130, damping: 19, reduceMotion: ReduceMotion.System },
  snap: {
    duration: 350,
    dampingRatio: 0.92,
    overshootClamping: true,
    reduceMotion: ReduceMotion.System,
  },
  drop: { mass: 1, damping: 14, stiffness: 260, reduceMotion: ReduceMotion.System },
  pop: { duration: 550, dampingRatio: 0.75, reduceMotion: ReduceMotion.System },
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

/**
 * Where a floating dock sits above the tab bar, and what a docked bar pads
 * its bottom with. ONE formula on purpose: two tabs used to compute the same
 * clearance with two different expressions (one halved the safe-area inset),
 * so the same chrome sat at two heights on one phone.
 */
export function tabDockBottom(bottomInset: number) {
  return BottomTabInset + bottomInset + Space.sm;
}

export const MaxContentWidth = 800;
