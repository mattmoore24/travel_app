import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
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
 * `tabDockBottom(insets.bottom)` because a tab bar floats under it, while a
 * stacked screen with a nav header passes the bare safe-area inset —
 * carrying BottomTabInset onto a stacked screen floats the bar 49pt too
 * high.
 */
export function DockedActionBar({
  primaryLabel,
  onPrimary,
  disabled = false,
  secondary,
  bottomInset,
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
}) {
  const theme = useTheme();
  const barHeight = dockedActionBarHeight(bottomInset);
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
      <View style={[styles.bar, { paddingBottom: bottomInset }]} pointerEvents="box-none">
        {secondary}
        <View style={styles.primaryWrap}>
          <PrimaryButton
            label={primaryLabel}
            disabled={disabled}
            maxFontSizeMultiplier={BAR_SCALE_CAP}
            onPress={onPrimary}
          />
        </View>
      </View>
    </>
  );
}

/**
 * Dynamic Type cap for the labels inside the bar: its height is a layout
 * constant, so an uncapped label outgrows the 52pt buttons and lifts them
 * off the opaque plate onto the translucent ramp — the exact defect the
 * plate exists to prevent. Do not spray this cap beyond bars whose height
 * is a layout constant.
 */
export const BAR_SCALE_CAP = 1.4;

/** The primary button's height, and any secondary pill's. */
export const ACTION_BUTTON = 52;

/**
 * How tall the bar actually is — and therefore how tall its opaque plate is
 * and where a screen's scroll clearance comes from. Derive clearance from
 * this, never from a magic number: the magic constant it replaced was 30pt
 * taller, so the fade started a line and a half above the bar and dissolved
 * whatever was there ("Both there Aug 23 - 28", sliced in half at rest —
 * run 44).
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
