import {
  DEFAULT_RADIUS_KM,
  RADIUS_OPTIONS_KM,
  distanceLabel,
  nearestRadiusOption,
  radiusChipLabel,
  radiusDetail,
  radiusLabel,
} from '@/features/matching/radius';

/**
 * The dial's words. The number itself is the server's (the policy behind
 * get_matches reads profiles.travelers_radius_km); this is what a person
 * reads off it, in the unit their phone measures a road in.
 */
describe('the travelers radius', () => {
  it('defaults to about twenty miles, which is one of the five steps', () => {
    expect(DEFAULT_RADIUS_KM).toBe(32);
    expect(RADIUS_OPTIONS_KM).toContain(DEFAULT_RADIUS_KM);
    // Nice reaches Cannes (26 km) at the default and not at the step below.
    expect(DEFAULT_RADIUS_KM).toBeGreaterThan(26);
    expect(RADIUS_OPTIONS_KM[1]).toBeLessThan(26);
  });

  it('says a distance the way the phone does', () => {
    expect(distanceLabel(26, true)).toBe('16 mi');
    expect(distanceLabel(26, false)).toBe('26 km');
    // Never a zero: the next street over is not "0 mi" away.
    expect(distanceLabel(0.3, true)).toBe('1 mi');
    expect(distanceLabel(0.3, false)).toBe('1 km');
  });

  it('names each step, this city only included', () => {
    expect(radiusLabel(0, true)).toBe('This city only');
    expect(radiusLabel(32, true)).toBe('Within 20 miles');
    expect(radiusLabel(32, false)).toBe('Within 32 km');
    expect(radiusChipLabel(32, true)).toBe('Within 20 mi');
    expect(radiusChipLabel(0, false)).toBe('This city only');
  });

  it('gives each row the other unit and nothing else', () => {
    // The conversion and nothing after it (founder, 2026-09-04: "the km
    // conversion is enough"); the city-only row has no other unit to give.
    expect(radiusDetail(32, true)).toBe('32 km');
    expect(radiusDetail(32, false)).toBe('20 miles');
    expect(radiusDetail(16, true)).toBe('16 km');
    expect(radiusDetail(160, false)).toBe('99 miles');
    expect(radiusDetail(0, true)).toBeNull();
    expect(radiusDetail(0, false)).toBeNull();
  });

  it('lights the nearest row for a number the picker never offered', () => {
    // The column allows 0..500; a value written by hand still lights a row.
    expect(nearestRadiusOption(30)).toBe(32);
    expect(nearestRadiusOption(500)).toBe(160);
    expect(nearestRadiusOption(5)).toBe(0);
  });

  it('never says where anybody is', () => {
    for (const option of RADIUS_OPTIONS_KM) {
      for (const text of [
        radiusLabel(option),
        radiusDetail(option) ?? '',
        radiusChipLabel(option),
      ]) {
        expect(text).not.toMatch(/near you|nearby|here now|around you/i);
      }
    }
  });
});
