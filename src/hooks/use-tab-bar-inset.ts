import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, Space } from '@/constants/theme';

/**
 * How much vertical room the native tab bar takes, as a HOOK, because the
 * number is not a constant: the bar's height is driven by its item labels,
 * and those scale with Dynamic Type. `BottomTabInset` (50 on iOS) was
 * measured at the default text size; at the accessibility sizes the real bar
 * grows upward while every floating dock built on the constant stayed put,
 * which slid "Drop a pin" and "Say hi" underneath it — the app's two primary
 * actions, untappable for exactly the people who raised their text size.
 *
 * NativeTabs publishes no height to JS (the bar is a real UITabBar, and the
 * BottomTabBarHeightContext in the tree belongs to the JS bottom-tabs this
 * app does not use), so the inset is DERIVED from fontScale rather than
 * measured. iOS 26's `NativeTabs.BottomAccessory` would make the clearance
 * the system's problem, but it is ONE accessory for the whole bar and this
 * app docks different chrome per tab, so it does not fit here.
 *
 * The multiplier is clamped: the bar is an icon plus one label line, not a
 * whole screen of text, so it grows slower than fontScale once the label is
 * large. The floor is the constant itself — the bar never shrinks below its
 * default-size height, so neither does the inset.
 */
const MAX_TAB_BAR_SCALE = 2;

export function useTabBarInset(): number {
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(Math.max(fontScale, 1), MAX_TAB_BAR_SCALE);
  return Math.round(BottomTabInset * scale);
}

/**
 * Where a floating dock sits above the tab bar, and what a docked bar pads
 * its bottom with. ONE formula on purpose: two tabs used to compute the same
 * clearance with two different expressions (one halved the safe-area inset),
 * so the same chrome sat at two heights on one phone. Moved here from
 * `constants/theme.ts` when the tab-bar half became a hook.
 *
 * Only for screens that SIT on the tab bar. A stacked screen with a nav
 * header has no tab bar under it and pads with the bare safe-area inset —
 * carrying this onto one floats its bar 49pt too high.
 */
export function useTabDockBottom(): number {
  const tabBarInset = useTabBarInset();
  const insets = useSafeAreaInsets();
  return tabBarInset + insets.bottom + Space.sm;
}
