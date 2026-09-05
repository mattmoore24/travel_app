import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The floating primary-action bar a terminal screen docks over its scroll
 * view: Say hi on the Travelers queue, Say hi on a stranger's profile.
 *
 * Lifted from the Travelers tab, where the pattern was worked out the hard
 * way. The bar floats over a scrolling photo-and-text page, so it needs a
 * ground of its own or the words behind it compete with the words on it.
 * Two inert layers: a SOLID plate exactly as tall as the bar, and a short
 * ramp fading down to it from above. A single gradient reached full opacity
 * 55% of the way down its own height, which landed roughly 60pt below the
 * top of the buttons — so the whole button row sat on a half-transparent
 * wash and another trip's dates read through beside the primary action.
 *
 * Hit-testing is load-bearing: the backdrop and ramp stay
 * `pointerEvents="none"` and the bar `box-none`, or the invisible layers
 * swallow taps meant for the page under them — the trap the traps skill
 * records for full-screen views that paint nothing.
 *
 * `bottomInset` is EXPLICIT, not read from context: the Travelers tab passes
 * `useTabDockBottom()` because a tab bar floats under it, while a stacked
 * screen with a nav header passes the bare safe-area inset — carrying the
 * tab-bar inset onto a stacked screen floats the bar 49pt too high.
 */
export function DockedActionBar({
  primaryLabel,
  onPrimary,
  disabled = false,
  secondary,
  bottomInset,
  primaryAccessibilityLabel,
  onBarHeight,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  /**
   * Renders the not-now colours (surfaceSunken fill, textSecondary label),
   * never a fade — 'Message sent' and 'No hellos left today' stay legible
   * while they say not-now.
   */
  disabled?: boolean;
  /** An optional circle or pill docked left of the primary (Travelers' Next). */
  secondary?: ReactNode;
  /** Space below the button row: the tab dock on a tab, the safe area on a stack. */
  bottomInset: number;
  /** Spoken label for the primary, when the visible words are not enough. */
  primaryAccessibilityLabel?: string;
  /**
   * The bar's measured height, for the screen's scroll clearance. Seed any
   * state you hold with `dockedActionBarHeight(bottomInset)` so the first
   * frame is right and the measurement only corrects it.
   */
  onBarHeight?: (height: number) => void;
}) {
  const theme = useTheme();
  // MEASURED, not derived: the buttons are minHeight around labels that
  // scale with Dynamic Type, so at the accessibility sizes the real bar is
  // taller than any formula says. Deriving the plate from the formula is
  // what put the buttons back on the translucent ramp and ran the bio under
  // them — twice, per this file's own history. The formula survives only as
  // the first-frame seed, corrected by onLayout before anything scrolls.
  const [measured, setMeasured] = useState<number | null>(null);
  const barHeight = measured ?? dockedActionBarHeight(bottomInset);
  return (
    <>
      <View
        style={[styles.backdrop, { height: barHeight, backgroundColor: theme.background }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', theme.background]}
        locations={[0, 1]}
        style={[styles.ramp, { height: ACTION_BAR_RAMP, bottom: barHeight }]}
        pointerEvents="none"
      />
      <View
        style={[styles.bar, { paddingBottom: bottomInset }]}
        pointerEvents="box-none"
        // The bar is bottom-anchored with its padding inside, so its layout
        // height IS the full bar height: paddingTop + row + bottomInset.
        onLayout={(event) => {
          const height = Math.round(event.nativeEvent.layout.height);
          setMeasured(height);
          onBarHeight?.(height);
        }}>
        {secondary}
        <View style={styles.primaryWrap}>
          <PrimaryButton
            label={primaryLabel}
            accessibilityLabel={primaryAccessibilityLabel}
            disabled={disabled}
            onPress={onPrimary}
          />
        </View>
      </View>
    </>
  );
}

/** The primary button's MINIMUM height, and any secondary pill's floor. */
export const ACTION_BUTTON = 52;

/**
 * The bar's height at the default text size — the SEED for the measured
 * height above and for any screen state that feeds scroll clearance, never
 * the truth on its own. Derive first-frame clearance from this, never from
 * a magic number: the magic constant it replaced was 30pt taller, so the
 * fade started a line and a half above the bar and dissolved whatever was
 * there ("Both there Aug 23 - 28", sliced in half at rest — run 44).
 */
export function dockedActionBarHeight(bottomInset: number) {
  return Space.sm + ACTION_BUTTON + bottomInset;
}

/** Ramp above the bar. Long enough to read as a fade, short enough that it
 *  starts at the bar rather than over the content. */
const ACTION_BAR_RAMP = Space.xxl;

/** Corner radius secondary pills share with the primary. */
export const ACTION_BAR_PILL_RADIUS = Radius.pill;

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  ramp: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
  },
  primaryWrap: {
    flex: 1,
  },
});
