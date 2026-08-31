/**
 * Camera framing for the map, as pure geometry so the clamps are testable.
 *
 * Every city used to open at the same hardcoded 0.09-degree box on the city
 * centroid and was never re-fitted: in Bangkok the markers occupied the
 * middle third of the frame while empty districts filled the rest, and a
 * filter that removed pins never re-framed what survived — so a narrowed map
 * looked emptier than the data warranted.
 */

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * The tightest the fit may go — the delta the address-search flyTo already
 * lands at. Fitting a single pin any closer turns the map into a doormat.
 */
export const MIN_FIT_SPAN = 0.012;

/** The widest — the existing city-chip framing. */
export const MAX_FIT_SPAN = 0.09;

/**
 * Breathing room around the outermost markers, as a factor on the raw
 * bounds. Without it the two extreme pins sit exactly on the screen edges.
 */
const PAD_FACTOR = 1.5;

/**
 * How far south of the true centre the camera sits, as a fraction of the
 * latitude span: the city rail owns the top of the screen and the dock plus
 * the plan list own the bottom, and the bottom band is the taller one, so
 * the content is lifted a step north of centre to clear it.
 */
const CHROME_BIAS = 0.06;

/** How far the camera can drift from the active city before the way home shows. */
export const FAR_FROM_CITY_M = 4000;

/**
 * The region that frames every given point, clamped between MIN_FIT_SPAN and
 * MAX_FIT_SPAN. Null when there is nothing to frame — the caller keeps the
 * camera where it is rather than flying to a guess.
 */
export function fitRegion(points: { lat: number; lng: number }[]): Region | null {
  if (points.length === 0) {
    return null;
  }
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }
  const clamp = (span: number) => Math.min(MAX_FIT_SPAN, Math.max(MIN_FIT_SPAN, span * PAD_FACTOR));
  const latitudeDelta = clamp(maxLat - minLat);
  return {
    latitude: (minLat + maxLat) / 2 - latitudeDelta * CHROME_BIAS,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta: clamp(maxLng - minLng),
  };
}

/**
 * Whether any of the given points is inside the region's box. The empty
 * banner uses this to tell "this city is quiet" from "you panned away from
 * where the plans are" — two states that used to render identically.
 */
export function anyInRegion(points: { lat: number; lng: number }[], region: Region): boolean {
  return points.some(
    (point) =>
      Math.abs(point.lat - region.latitude) <= region.latitudeDelta / 2 &&
      Math.abs(point.lng - region.longitude) <= region.longitudeDelta / 2
  );
}
