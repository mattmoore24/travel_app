import type { ReactNode } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { StyleSheet } from 'react-native';

type LocationPickerProps = {
  centerLat: number;
  centerLng: number;
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  /** Mirrors the native picker so shared call sites typecheck. */
  marker?: ReactNode;
  placed?: boolean;
  delta?: number;
};

// Web dev fallback: no native map — the pin lands at the city center.
export function LocationPicker(_props: LocationPickerProps) {
  return (
    <ThemedView type="backgroundElement" style={styles.note}>
      <ThemedText type="small" themeColor="textSecondary">
        Picking a spot needs the native map. On web the pin sits at the city center.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  note: {
    padding: Spacing.three,
    borderRadius: Radius.lg,
  },
});
