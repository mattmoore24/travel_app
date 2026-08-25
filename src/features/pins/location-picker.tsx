import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polygon, PROVIDER_DEFAULT } from 'react-native-maps';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { MAP_WASH, QUIET_BASEMAP, SHOW_POINTS_OF_INTEREST, washBox } from '@/features/pins/basemap';

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
        // Venue zoom, which is where Apple's place names are most useful:
        // somebody dropping a pin on a bar wants to see which bar. Both maps
        // answer the same way, from the same constant.
        {...QUIET_BASEMAP}
        showsPointsOfInterests={SHOW_POINTS_OF_INTEREST}
        onPress={(event) => {
          const { latitude, longitude } = event.nativeEvent.coordinate;
          onChange(latitude, longitude);
        }}>
        {/* The same wash the map tab draws. It was missing here, which is
            the drift basemap.ts exists to stop: the shared constant covers
            props, and the wash is an overlay, so only the screen that
            remembered to draw it got one. Harmless while both maps were
            mutedStandard; visible the moment the map type changed, because
            this one would have jumped further than the other. */}
        <Polygon
          coordinates={washBox(centerLat, centerLng)}
          fillColor={MAP_WASH}
          strokeColor="transparent"
          strokeWidth={0}
          tappable={false}
        />
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
        Drag it to the spot.
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
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
});
