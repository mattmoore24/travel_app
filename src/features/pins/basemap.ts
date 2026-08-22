/**
 * How Apple's basemap is told to stay out of the way.
 *
 * The app has two MapViews - the map tab and the drop-a-pin location picker -
 * and they had drifted: the picker had no treatment at all, which is worse
 * than it sounds, because it sits at venue zoom, the exact band where Apple
 * draws bright pills for restaurants and bars. The categories this app's pins
 * are about. One constant so they cannot drift again.
 *
 * Every value here is a plain prop on the native view already in the binary,
 * so all of it ships over the air.
 */

/**
 * mutedStandard is MKMapTypeMutedStandard, Apple's "somebody else's data on
 * top" style: park green, building fill, road casing and water all
 * desaturated, label contrast dropped. It does NOT remove labels and does NOT
 * remove POI icons - see POINTS_OF_INTEREST below for that half.
 *
 * rotate and pitch are off because the compass on iOS is adaptive: it appears
 * the moment the map is rotated off north, so refusing the rotation retires
 * the chrome permanently instead of hoping the flag holds. Pitch off also
 * stops a two-finger drag tilting into 3D, where extruded buildings and
 * perspective labels come back.
 *
 * `showsBuildings`, `rotateEnabled` and `pitchEnabled` are all documented in
 * the .d.ts as unsupported or Google-only on iOS, and all three are wrong for
 * 1.27.2: RNMapsMapView.mm remaps each straight onto AIRMap, which is an
 * MKMapView subclass that overrides none of their setters. `showsIndoors` is
 * the one that really is dead - it is declared in the codegen props and read
 * by nothing in the Apple sources - so it is deliberately absent here.
 */
export const QUIET_BASEMAP = {
  mapType: 'mutedStandard',
  userInterfaceStyle: 'dark',
  showsBuildings: false,
  showsTraffic: false,
  showsCompass: false,
  showsScale: false,
  showsUserLocation: false,
  rotateEnabled: false,
  pitchEnabled: false,
} as const;

/**
 * Why turning the points of interest off needs a second render.
 *
 * On iOS 16+ the POI prop is implemented by copying MKMapView's
 * preferredConfiguration and writing a pointOfInterestFilter onto it
 * (AIRMap.mm setShowsPointsOfInterests). `mapType` is written straight to
 * MKMapView.mapType, which is the same underlying state and installs a fresh
 * default configuration for that type - discarding the filter. In one
 * updateProps pass RNMapsMapView.mm applies the POI prop first and mapType
 * twenty-five lines later, so on mount, when both change together, the map
 * type wins and the POI icons stay.
 *
 * Neither prop ever changes again, and the native remap is guarded on
 * old != new, so nothing re-applies it. Holding the value in state and
 * flipping it once the map is up puts the POI write in a LATER commit, where
 * mapType is unchanged and the filter survives. Costs one frame of pills.
 *
 * The array form (`pointsOfInterestFilter`) IS applied after mapType, but it
 * can only ever include categories - the native side builds
 * initIncludingCategories and bails on an empty array - so it cannot say
 * "none of them".
 */
export function pointsOfInterest(mapReady: boolean) {
  return !mapReady;
}
