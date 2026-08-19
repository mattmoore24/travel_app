import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Elevation, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type GlassSurfaceProps = {
  children: ReactNode;
  /** 'clear' for controls over photography/map, 'regular' for content panels. */
  variant?: 'clear' | 'regular';
  /** Tint the glass with the accent (used for selected states). */
  tinted?: boolean;
  radius?: number;
  style?: ViewStyle | ViewStyle[];
  /**
   * Set 'none' when a Pressable wraps this surface. The native glass view
   * mounts children inside a UIVisualEffectView whose hit-testing competes
   * with RN's responder — opting the glass out of touches entirely is what
   * makes the wrapping Pressable reliable on the first tap.
   */
  pointerEvents?: 'auto' | 'none' | 'box-none';
};

/**
 * iOS 26 Liquid Glass where the OS supports it, an opaque surface everywhere
 * else. Every use must stay legible on the fallback too — glass is a finish,
 * never the thing carrying contrast (docs/DESIGN.md).
 */
export function GlassSurface({
  children,
  variant = 'regular',
  tinted = false,
  radius = Radius.lg,
  style,
  pointerEvents,
}: GlassSurfaceProps) {
  const theme = useTheme();
  const shape = [{ borderRadius: radius }, Elevation.floating, style];

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView
        glassEffectStyle={variant}
        tintColor={tinted ? theme.accentSoft : undefined}
        pointerEvents={pointerEvents}
        style={[styles.clip, shape]}>
        {children}
      </GlassView>
    );
  }

  return (
    <View
      pointerEvents={pointerEvents}
      style={[styles.clip, { backgroundColor: tinted ? theme.accentSoft : theme.surface }, shape]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});
