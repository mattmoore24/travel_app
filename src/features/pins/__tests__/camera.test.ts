import { MAX_FIT_SPAN, MIN_FIT_SPAN, anyInRegion, fitRegion } from '@/features/pins/camera';

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

  it('pads the raw bounds so the outermost pins clear the screen edges', () => {
    const region = fitRegion([
      { lat: 13.75, lng: 100.5 },
      { lat: 13.78, lng: 100.53 },
    ])!;
    expect(region.latitudeDelta).toBeGreaterThan(0.03);
    expect(region.latitudeDelta).toBeLessThanOrEqual(MAX_FIT_SPAN);
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
