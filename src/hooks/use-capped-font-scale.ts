import { useWindowDimensions } from 'react-native';

/**
 * fontScale, floored at 1 and capped.
 *
 * The layout half of a `FontCap`. `maxFontSizeMultiplier` stops a LABEL at
 * the cap; this stops the NUMBER a bar or a row derives from that label at
 * the same place, so the two cannot drift apart. The keyboard bar is the
 * worked example: its minHeight is a callout line plus padding, its label is
 * capped at `FontCap.control`, and both read the multiplier from here. A bar
 * that grew by the raw fontScale while its label stopped at 1.5x would carry
 * dead space at the accessibility sizes; the other way round, the label
 * outgrows the bar, which is exactly the overlap the Travelers action bar
 * used to show (components/form/primary-button).
 *
 * Floored at 1 because text can also be set SMALLER than the default, and
 * every fixed-height piece of chrome here was drawn at the default size and
 * treats it as its minimum: a 44pt target shrunk to 40 is the one thing a
 * smaller text size must never buy. The same clamp useTabBarInset applies.
 */
export function capFontScale(fontScale: number, cap: number): number {
  return Math.min(Math.max(fontScale, 1), cap);
}

export function useCappedFontScale(cap: number): number {
  const { fontScale } = useWindowDimensions();
  return capFontScale(fontScale, cap);
}
