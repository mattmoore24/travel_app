import { MOVE_RESETS_KM, movedFar, normalizedName } from '@/app/business-edit';

// The editor's address field reaches the local native search module, which
// jest's `@/` mapper does not cover (it points at src/, and that module lives
// in modules/). Nothing under test here goes near it, and stubbing the field
// is cheaper than teaching the resolver about a second root.
jest.mock('@/features/business/address-field', () => ({
  BusinessAddressField: () => null,
  addressFrom: () => '',
}));

// And the map, whose TurboModule does not exist outside a native binary. The
// editor draws one; the arithmetic under test has never heard of it. Same
// shape of stub features/pins/__tests__/location-picker.test.tsx uses.
jest.mock('react-native-maps', () => ({
  __esModule: true,
  default: () => null,
  Marker: () => null,
  Polygon: () => null,
  PROVIDER_DEFAULT: 'default',
}));

/**
 * The two thresholds that decide whether an edit costs the check.
 *
 * `business_rename_resets` used to compare name, city_id, lat and lng with
 * `is distinct from`, so "Cafe Janis" becoming "Café Janis" — or the marker
 * moving the ten metres from the middle of the road onto the actual door —
 * nulled `verified_at` and dropped a listed business back to 'unconfirmed'.
 * 20260902100000 narrowed that to a normalised rename, a city change, or a
 * move over seventy-five metres, and
 * supabase/tests/database/46_a_typo_is_not_a_hijack.test.sql proves the
 * server half.
 *
 * These two helpers are the client's copy of the same arithmetic, and they
 * exist so the editor's warnings say what the database will actually do. The
 * threshold IS the argument, so it gets its own test: too small and accuracy
 * is punished again, too large and a surf shack walks to the Marriott's
 * address without losing its badge.
 */

/** Roughly metres per degree of latitude, anywhere on the globe. */
const M_PER_DEG_LAT = 111_320;
const LISBON = { lat: 38.7108, lng: -9.14 };
const northOf = (metres: number) => ({
  lat: LISBON.lat + metres / M_PER_DEG_LAT,
  lng: LISBON.lng,
});

describe('movedFar', () => {
  it('is seventy-five metres, not seventy-five kilometres', () => {
    expect(MOVE_RESETS_KM).toBe(0.075);
  });

  it('says no to a marker that has not moved at all', () => {
    expect(movedFar(LISBON, LISBON)).toBe(false);
  });

  it('says no to the ten-metre nudge onto the door', () => {
    expect(movedFar(LISBON, northOf(10))).toBe(false);
  });

  it('still says no just inside the line', () => {
    expect(movedFar(LISBON, northOf(70))).toBe(false);
  });

  it('says yes just outside it', () => {
    expect(movedFar(LISBON, northOf(80))).toBe(true);
  });

  it('says yes to half a kilometre, which is a different building', () => {
    expect(movedFar(LISBON, northOf(500))).toBe(true);
  });

  it('measures longitude too, and shrinks it by the latitude', () => {
    // A degree of longitude is only cos(38.7) as long as a degree of
    // latitude here, so the same delta east has to read as a shorter move.
    const east = { lat: LISBON.lat, lng: LISBON.lng + 80 / M_PER_DEG_LAT };
    expect(movedFar(LISBON, east)).toBe(false);
  });
});

describe('normalizedName', () => {
  it('folds an accent, so Cafe and Café are one name', () => {
    expect(normalizedName('Café Janis')).toBe(normalizedName('Cafe Janis'));
  });

  it('folds a decomposed accent the same way a precomposed one folds', () => {
    // iOS hands back NFC, but a paste from anywhere else can arrive NFD, and
    // the two must not disagree about whether the name changed. An "e" plus
    // a combining acute is the same word as the precomposed character.
    expect(normalizedName('Cafe\u0301 Janis')).toBe(normalizedName('Caf\u00e9 Janis'));
  });

  it('folds capitals and collapses runs of whitespace', () => {
    expect(normalizedName('  cafe   JANIS ')).toBe(normalizedName('Cafe Janis'));
  });

  it('keeps a real rename a real rename', () => {
    // The attack the reset exists for. No amount of normalising makes these
    // the same business.
    expect(normalizedName('Surf Shack')).not.toBe(normalizedName('Marriott'));
  });

  it('keeps a fixed spelling a rename, because it is one', () => {
    // Letters that are not diacritics are a different name, and the
    // re-confirmation mail is the only thing that can vouch for it.
    expect(normalizedName('Cafe Jansi')).not.toBe(normalizedName('Cafe Janis'));
  });
});
