import { FOLLOW_MIN_KM, isOverCity, shouldFollowMap } from '@/features/pins/follow-the-map';

// Bangkok's centre, and points at known distances from it.
const bangkok = { lat: 13.7563, lng: 100.5018 };
const inTown = { latitude: 13.7563, longitude: 100.55 }; // ~5 km east
const wellOut = { latitude: 13.7563, longitude: 100.75 }; // ~27 km east
const porto = { latitude: 41.1496, longitude: -8.6109 };

describe('shouldFollowMap', () => {
  it('never asks past city scale: a centre at country zoom names nothing', () => {
    expect(shouldFollowMap(porto, bangkok, true)).toBe(false);
  });

  it("never asks while the centre is inside the resolver's own hint radius", () => {
    expect(FOLLOW_MIN_KM).toBe(20);
    expect(shouldFollowMap(inTown, bangkok, false)).toBe(false);
  });

  it('asks once the centre is past it, whether the next city is near or far', () => {
    expect(shouldFollowMap(wellOut, bangkok, false)).toBe(true);
    expect(shouldFollowMap(porto, bangkok, false)).toBe(true);
  });

  it('has nothing to follow from without a browsed city', () => {
    expect(shouldFollowMap(porto, null, false)).toBe(false);
  });
});

describe('isOverCity', () => {
  // The arrival gate: the map has to have settled over the browsed city once
  // before a settle away from it counts as a pan. A flight cut short (run
  // 137: Bangkok toward Denpasar, settled over Cambodia) is not an arrival.
  it('is the same radius the follow starts past, so the two cannot overlap', () => {
    expect(isOverCity(inTown, bangkok)).toBe(true);
    expect(isOverCity(wellOut, bangkok)).toBe(false);
    expect(shouldFollowMap(wellOut, bangkok, false)).toBe(true);
  });

  it('is never over a city there is none of', () => {
    expect(isOverCity(inTown, null)).toBe(false);
  });
});
