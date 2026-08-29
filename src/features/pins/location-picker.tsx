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
  /**
   * Whether `lat`/`lng` are a real choice or just somewhere to look.
   *
   * A business signing up has not placed anything yet, and the map was
   * drawing a marker on the city centre anyway — so the screen showed a
   * marker, refused Continue, and asked for a marker. False draws the map
   * with none and says what to do.
   */
  placed?: boolean;
  /**
   * How much world to show, in degrees. The default is the city, which is
   * right when somebody is still looking for their street.
   *
   * The confirm step passes a street-level value, because its whole question
   * is "is the marker on your door" and a city-wide map cannot answer it: run
   * 80 photographed "Is this right?" showing half of Lisbon with a pin
   * somewhere near the castle.
   */
  delta?: number;
};

/** Tap or drag to place the pin at venue level — never tied to GPS. */
export function LocationPicker({
  centerLat,
  centerLng,
  lat,
  lng,
  onChange,
  placed = true,
  delta = 0.06,
}: LocationPickerProps) {
  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: centerLat,
          longitude: centerLng,
          latitudeDelta: delta,
          longitudeDelta: delta,
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
        {placed ? (
          <Marker
            coordinate={{ latitude: lat, longitude: lng }}
            draggable
            onDragEnd={(event) => {
              const { latitude, longitude } = event.nativeEvent.coordinate;
              onChange(latitude, longitude);
            }}
          />
        ) : null}
      </MapView>
      <ThemedText type="small" themeColor="textSecondary">
        {placed ? 'Drag it to the spot.' : 'Tap the map to drop your marker.'}
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
