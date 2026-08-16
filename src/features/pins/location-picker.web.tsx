import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { StyleSheet } from 'react-native';

type LocationPickerProps = {
  centerLat: number;
  centerLng: number;
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
};

// Web dev fallback: no native map — the pin lands at the city center.
export function LocationPicker(_props: LocationPickerProps) {
  return (
    <ThemedView type="backgroundElement" style={styles.note}>
      <ThemedText type="small" themeColor="textSecondary">
        Location picking needs the native map — on web the pin is placed at the city center.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  note: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
});
