import {
  FAR_FROM_CITY_M,
  MAX_FIT_SPAN,
  MIN_FIT_SPAN,
  anyInRegion,
  fitRegion,
  homeRegion,
} from '@/features/pins/camera';
import { metersBetween } from '@/features/pins/cluster';
import { between, source } from '@/lib/__tests__/source';

// The camera frames its own data now, instead of opening every city on the
// same hardcoded 0.09-degree box. The clamps are the contract: never tighter
// than the flyTo delta, never wider than the city chip's framing.

describe('fitRegion', () => {
  it('has nothing to frame on an empty map', () => {
    expect(fitRegion([])).toBeNull();
  });

  it('frames a single pin at the minimum span, not a doormat', () => {
    const region = fitRegion([{ lat: 13.75, lng: 100.5 }])!;
    expect(region.latitudeDelta).toBe(MIN_FIT_SPAN);
    expect(region.longitudeDelta).toBe(MIN_FIT_SPAN);
    expect(region.longitude).toBe(100.5);
  });

  it('clamps a city-wide spread to the existing 0.09 maximum', () => {
    const region = fitRegion([
      { lat: 13.7, lng: 100.4 },
      { lat: 13.9, lng: 100.7 },
    ])!;
    expect(region.latitudeDelta).toBe(MAX_FIT_SPAN);
    expect(region.longitudeDelta).toBe(MAX_FIT_SPAN);
  });

  it('frames the most of its data when the spread is wider than the widest frame', () => {
    // Run 119's relaunch frame: nine plans around Seminyak and Canggu, one
    // business chip in Ubud, and a box centred between them that held
    // nothing. The frame goes where the plans are; Ubud is a scroll away.
    const seminyak = Array.from({ length: 9 }, (_, i) => ({
      lat: -8.69 + i * 0.004,
      lng: 115.15 + i * 0.003,
    }));
    const ubud = { lat: -8.506, lng: 115.262 };
    const region = fitRegion([...seminyak, ubud])!;
    expect(region.latitudeDelta).toBe(MAX_FIT_SPAN);
    expect(region.longitudeDelta).toBe(MAX_FIT_SPAN);
    expect(anyInRegion(seminyak, region)).toBe(true);
    for (const point of seminyak) {
      expect(anyInRegion([point], region)).toBe(true);
    }
    expect(anyInRegion([ubud], region)).toBe(false);
  });

  it('keeps the middle of a spread that fits, so nothing moves that did not have to', () => {
    const region = fitRegion([
      { lat: 13.75, lng: 100.5 },
      { lat: 13.76, lng: 100.52 },
    ])!;
    expect(region.longitude).toBeCloseTo(100.51, 6);
  });

  it('pads the raw bounds so the outermost pins clear the screen edges', () => {
    const region = fitRegion([
      { lat: 13.75, lng: 100.5 },
      { lat: 13.78, lng: 100.53 },
    ])!;
    expect(region.latitudeDelta).toBeGreaterThan(0.03);
    expect(region.latitudeDelta).toBeLessThanOrEqual(MAX_FIT_SPAN);
  });
});

describe('homeRegion', () => {
  // Denpasar's launch pins and the city row's own coordinate, from the seed
  // (20260818010000 and 20260816200100): Canggu to Uluwatu to Ubud.
  const denpasar = { lat: -8.65, lng: 115.21667 };
  const plans = [
    { lat: -8.6478, lng: 115.1385 },
    { lat: -8.6931, lng: 115.262 },
    { lat: -8.5194, lng: 115.2606 },
    { lat: -8.8291, lng: 115.0849 },
    { lat: -8.66, lng: 115.13 },
  ];

  it('is the fit over the plans once there are any', () => {
    expect(homeRegion(plans, denpasar)).toEqual(fitRegion(plans));
  });

  it("is the city's own box until then", () => {
    expect(homeRegion([], denpasar)).toEqual({
      latitude: denpasar.lat,
      longitude: denpasar.lng,
      latitudeDelta: MAX_FIT_SPAN,
      longitudeDelta: MAX_FIT_SPAN,
    });
  });

  it('is not the centroid: a spread-out city frames itself past the drift threshold', () => {
    // The E2E run 115 frame: the app framed Denpasar's plans and then said
    // "Back to Denpasar" about its own frame. Home is the reference now, so
    // the map is at home by construction the moment the fit lands.
    const home = homeRegion(plans, denpasar);
    expect(
      metersBetween(home.latitude, home.longitude, denpasar.lat, denpasar.lng)
    ).toBeGreaterThan(FAR_FROM_CITY_M);
  });

  it('is what the map measures from and lands on', () => {
    const screen = source('src/features/pins/map-screen.tsx');
    expect(screen).toContain(
      'metersBetween(mapCentre.lat, mapCentre.lng, home.latitude, home.longitude) > FAR_FROM_CITY_M'
    );
    // The pill and the lit chip's tap both go home, never to the centroid's
    // 0.09 box, which for Denpasar is a place that summons the pill again.
    const pill = between(screen, "{slot === 'way-home' && activeCity ? (", '</Animated.View>');
    expect(pill).toContain('onPress={goHome}');
    expect(pill).not.toContain('activeCity.cities.lat');
    const chip = between(screen, 'const selectCity = (city: BrowseCity) => {', 'applyCity(city);');
    expect(chip).toContain('goHome();');
  });
});

describe('anyInRegion', () => {
  const region = { latitude: 13.75, longitude: 100.5, latitudeDelta: 0.09, longitudeDelta: 0.09 };

  it('sees a pin inside the frame', () => {
    expect(anyInRegion([{ lat: 13.76, lng: 100.51 }], region)).toBe(true);
  });

  it('knows when every pin has scrolled off', () => {
    // The state that used to be indistinguishable from an empty city.
    expect(anyInRegion([{ lat: 13.76, lng: 100.7 }], region)).toBe(false);
    expect(anyInRegion([], region)).toBe(false);
  });
});
