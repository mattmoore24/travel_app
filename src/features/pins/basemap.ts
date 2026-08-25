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
 * `standard` in a dark interface style, NOT mutedStandard.
 *
 * mutedStandard is MKMapTypeMutedStandard, Apple's "somebody else's data on
 * top" style. It drops label contrast as well as saturation, and stacked
 * under the ink wash below it took a street name to roughly 2:1 against the
 * ground - readable only if you already knew what it said. The founder's
 * report on 2026-08-23 was exactly that: the map is too dark to read.
 *
 * Two darkeners were doing the same job, so the blunter one goes. `standard`
 * in a dark interface style is the map Apple itself shows at night: roads
 * separate cleanly from the ground, labels are legible, and the palette is
 * already navy rather than white, so the theme survives intact. Saturation
 * comes back with it - park green, water blue - which is what the wash is
 * still here for, at a third of its old strength.
 *
 * It does NOT remove labels, and as of 2026-08-24 it does not remove the
 * points of interest either - see SHOW_POINTS_OF_INTEREST below.
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
  mapType: 'standard',
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
 * The places stay on the map. Founder, 2026-08-24:
 *
 *   "I liked when you could see all of the names of places/restaurants/other
 *    that are usually visible in the map alongside people's pins."
 *
 * They had been turned off, on the reasoning that Apple's bright pills for
 * restaurants and bars compete with our amber pins in exactly the categories
 * this app is about. That reasoning was about the pins winning the eye. It is
 * not worth what it cost: a plan to meet at a bar is only useful if you can
 * see which bar, and a map with no names on it is a map you cannot navigate
 * by. The wash (MAP_WASH) is what keeps our pins the brightest thing, and it
 * still does that job with the POIs on.
 *
 * A constant rather than an inline `true` so both MapViews keep answering the
 * same way. They have drifted apart once already.
 *
 * Kept for whoever turns them off again, because it took a day to find:
 * on iOS 16+ this prop is implemented by copying MKMapView's
 * preferredConfiguration and writing a pointOfInterestFilter onto it
 * (AIRMap.mm setShowsPointsOfInterests), while `mapType` is written straight
 * to MKMapView.mapType - the same underlying state, and setting it installs a
 * fresh default configuration for that type, discarding the filter. In one
 * updateProps pass RNMapsMapView.mm applies the POI prop first and mapType
 * twenty-five lines later, so on mount, when both change together, the map
 * type wins and the icons stay. Turning them OFF therefore needs the write
 * deferred to a later commit (that is what the old onMapReady flag was for).
 * Turning them ON needs none of that, because the map type's own default is
 * to show them: the prop and the default agree, so whichever write lands last
 * gives the same answer. The array form (`pointsOfInterestFilter`) IS applied
 * after mapType but can only ever INCLUDE categories, so it cannot say "none
 * of them".
 */
export const SHOW_POINTS_OF_INTEREST = true;

/**
 * The ink wash that keeps our pins the brightest thing, and nothing more.
 *
 * Apple exposes no prop for label, road or water treatment - the
 * point-of-interest filter covers business categories only - so an overlay
 * is the last lever, and it is the right one: MapKit draws every overlay
 * beneath every annotation, so this touches the cartography and leaves the
 * faces, the heat and the curated stars exactly as bright as they were.
 *
 * That ordering is why the points of interest could come back on. Apple's
 * pills sit under this wash with the rest of the cartography; our pins sit
 * over it. The names are readable and still lose to an amber marker.
 *
 * The colour is the app's own canvas (#0E1020), and the number is the whole
 * lesson from 2026-08-23. At 0.34, on top of mutedStandard, it was the
 * second of two darkeners doing the same job and the map stopped being
 * readable. At 0.14, on top of `standard`, it does the one job an overlay is
 * actually good at: pulling Apple's park green and water blue back toward
 * the app's navy, and dropping the ground just far enough that an amber pin
 * still wins the eye. Street names stay legible on their own merits rather
 * than surviving in spite of this.
 *
 * If it ever needs tuning again, tune THIS and leave mapType alone. Raising
 * it past about 0.2 is how the map got hard to read the first time.
 */
export const MAP_WASH = 'rgba(14, 16, 32, 0.14)';

/**
 * A box big enough to cover any zoom this screen allows, centred on the city.
 *
 * Deliberately not a world polygon: one of those has to be reasoned about at
 * the antimeridian, and no launch city is near it. Twenty degrees is about
 * 2,200km each way; the map caps out far inside that.
 */
export function washBox(lat: number, lng: number) {
  const pad = 20;
  const north = Math.min(lat + pad, 85);
  const south = Math.max(lat - pad, -85);
  return [
    { latitude: north, longitude: lng - pad },
    { latitude: north, longitude: lng + pad },
    { latitude: south, longitude: lng + pad },
    { latitude: south, longitude: lng - pad },
  ];
}
