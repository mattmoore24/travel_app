import { Platform, useWindowDimensions } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

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
 * so the same chrome sat at two heights on one phone.
 *
 * On iOS the bar is ALREADY INSIDE the inset. expo-router wraps every native
 * tab screen's content in a SafeAreaProvider of its own (expo-router's
 * NativeTabsView.ios, `wrappedContent`), and a provider publishes its OWN
 * view's insets — a view UIKit has already grown by the tab bar. This file
 * used to claim the opposite ("NativeTabs publishes no height to JS, so the
 * inset is DERIVED from fontScale"), and adding the constant on top of a
 * measurement that already contained it put 50pt of dead map under every
 * dock. Measured off the founder's iPhone: the capsule's top edge and
 * `insets.bottom` are the same 83.3pt, and the plan card's top edge landed at
 * 257 (= 141.3 + 52 + 8 + 56) instead of 207.
 *
 * So the constant is a FALLBACK, never an addend on a measurement, and which
 * one applies is read off the inset itself:
 *
 *  - Inside a tab screen the tab's own provider reports MORE than the window
 *    does, because the bar is in it. Trust that: it tracks the real bar at
 *    every text size, which is strictly better than the fontScale estimate it
 *    replaces — that estimate is clamped at 2x and so already went short of a
 *    bar grown past 100pt.
 *  - Outside the tab host the inset is the home indicator alone and the bar
 *    has to be added. `ConnectedNotice` is mounted as a SIBLING of the tabs,
 *    so its nearest provider is the root one. The same branch covers the
 *    frame before a tab provider's native view has laid out, because it seeds
 *    from its parent and so reports the window's inset for one frame. That
 *    frame is why this is not a bare `insets.bottom`: the old bug slid the
 *    app's two primary actions under the bar, and no frame may do that again.
 *
 * Android and web keep the sum outright — there the bar is the app's own
 * chrome and sits outside the window inset.
 *
 * Only for screens that SIT on the tab bar. A stacked screen with a nav
 * header has no tab bar under it and pads with the bare safe-area inset —
 * carrying this onto one floats its bar 49pt too high.
 */
export function tabDockBottomOf({
  insetBottom,
  windowInsetBottom,
  tabBarInset,
  barInInset,
}: {
  insetBottom: number;
  windowInsetBottom: number;
  tabBarInset: number;
  /** iOS grows a tab child's own inset by the bar. Elsewhere it does not. */
  barInInset: boolean;
}): number {
  // A point of tolerance rather than equality: both numbers come from the
  // same native window, and a bar contributing less than a point is not a bar
  // worth subtracting.
  const measured = barInInset && insetBottom - windowInsetBottom > 1;
  return (measured ? insetBottom : tabBarInset + insetBottom) + Space.sm;
}

export function useTabDockBottom(): number {
  const tabBarInset = useTabBarInset();
  const insets = useSafeAreaInsets();
  return tabDockBottomOf({
    insetBottom: insets.bottom,
    windowInsetBottom: initialWindowMetrics?.insets.bottom ?? 0,
    tabBarInset,
    barInInset: Platform.OS === 'ios',
  });
}
