import { StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type LocationPickerProps = {
  centerLat: number;
  centerLng: number;
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
};

/** Tap or drag to place the pin at venue level — never tied to GPS. */
export function LocationPicker({ centerLat, centerLng, lat, lng, onChange }: LocationPickerProps) {
  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: centerLat,
          longitude: centerLng,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        }}
        showsUserLocation={false}
        onPress={(event) => {
          const { latitude, longitude } = event.nativeEvent.coordinate;
          onChange(latitude, longitude);
        }}>
        <Marker
          coordinate={{ latitude: lat, longitude: lng }}
          draggable
          onDragEnd={(event) => {
            const { latitude, longitude } = event.nativeEvent.coordinate;
            onChange(latitude, longitude);
          }}
        />
      </MapView>
      <ThemedText type="small" themeColor="textSecondary">
        Tap or drag the marker to the place you mean.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  map: {
    height: 220,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
});
