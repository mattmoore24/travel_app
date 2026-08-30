import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polygon, PROVIDER_DEFAULT } from 'react-native-maps';

import { ThemedText } from '@/components/themed-text';
import { Motion, Radius, Spacing } from '@/constants/theme';
import { MAP_WASH, QUIET_BASEMAP, SHOW_POINTS_OF_INTEREST, washBox } from '@/features/pins/basemap';

/**
 * Centred, matching business-marker.tsx's CHIP_ANCHOR: a chip has no tail,
 * so the marker IS the point, and a default anchor would sit it half a chip
 * off the door.
 */
const MARKER_CHILD_ANCHOR = { x: 0.5, y: 0.5 };

type LocationPickerProps = {
  centerLat: number;
  centerLng: number;
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  /**
   * What to draw at the point. Without one, MapKit draws its default
   * red-coral balloon — the one colour §7 bans as a UI colour — and the
   * wrong object besides: an owner would drag a red balloon and get a navy
   * chip. The callers pass the chip a traveler will actually tap.
   */
  marker?: ReactNode;
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
  marker,
  placed = true,
  delta = 0.06,
}: LocationPickerProps) {
  const mapRef = useRef<MapView>(null);
  // A drag hands the new coords to the caller, which hands them back as the
  // centre; without this flag the effect below would answer every marker
  // nudge by sliding the map underneath the person doing the nudging.
  const fromDrag = useRef(false);
  // The centre and delta are props but initialRegion is read once, so when a
  // geocoded address moves them (signup's address step goes city-wide to
  // street-level) the map flies there instead of staying on the city centre
  // under an instruction to check a door it is not showing.
  useEffect(() => {
    if (fromDrag.current) {
      fromDrag.current = false;
      return;
    }
    mapRef.current?.animateToRegion(
      { latitude: centerLat, longitude: centerLng, latitudeDelta: delta, longitudeDelta: delta },
      Motion.slow
    );
  }, [centerLat, centerLng, delta]);
  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
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
            anchor={marker ? MARKER_CHILD_ANCHOR : undefined}
            draggable
            onDragEnd={(event) => {
              const { latitude, longitude } = event.nativeEvent.coordinate;
              fromDrag.current = true;
              onChange(latitude, longitude);
            }}>
            {marker}
          </Marker>
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
    // 280, up from 220: this map hosts a drag task, and 220pt was small for
    // one — especially with a 26pt chip as the grab handle.
    height: 280,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
});
