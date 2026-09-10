import {
  DEFAULT_FILTERS,
  activeFilterCount,
  clockSkew,
  inWindow,
  isDefault,
  mapResultCount,
  pinPasses,
  rangeFor,
  showsBusinesses,
  showsHeat,
  todayWindow,
  toggle,
  windowFor,
  type MapFilters,
} from '@/features/pins/filters';
import type { CityPinRow } from '@/lib/database.types';

const NOW = new Date('2026-08-28T12:00:00Z');

const pin = (over: Partial<CityPinRow> = {}): CityPinRow =>
  ({
    id: 'p1',
    user_id: 'u1',
    display_name: 'Ana',
    age: 27,
    verified: false,
    photo_path: null,
    venue_name: 'Bar Tejo',
    note: null,
    place_label: null,
    category: 'bar',
    lat: 38.7,
    lng: -9.1,
    intent_date: '2026-08-28',
    seeded: false,
    take_down_on: '2026-08-28',
    plan_ends_at: '2026-08-29T00:00:00Z',
    expires_at: '2026-08-29T00:00:00Z',
    ...over,
  }) as CityPinRow;

const withFilters = (over: Partial<MapFilters>): MapFilters => ({ ...DEFAULT_FILTERS, ...over });

describe('the default is a map with nothing hidden', () => {
  it('counts as no filters at all', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(isDefault(DEFAULT_FILTERS)).toBe(true);
  });

  it('lets every pin through', () => {
    expect(pinPasses(pin(), DEFAULT_FILTERS, null)).toBe(true);
    expect(pinPasses(pin({ seeded: true, user_id: null }), DEFAULT_FILTERS, null)).toBe(true);
    expect(showsBusinesses(DEFAULT_FILTERS)).toBe(true);
  });

  it('draws the heat layer by default', () => {
    // Client-side only: the toggle decides whether already-thresholded cells
    // are painted, never what the server is asked.
    expect(showsHeat(DEFAULT_FILTERS)).toBe(true);
    expect(showsHeat(withFilters({ kinds: ['travelers'] }))).toBe(false);
  });

  it('is anytime, expressed as no window at all', () => {
    // The founder closed this on 2026-09-10: the map defaults to anytime.
    // An ABSENCE rather than a wide range, so the range arguments are left
    // off both RPC calls and the markers skip the date test entirely.
    expect(DEFAULT_FILTERS.when).toBe('anytime');
    expect(windowFor(DEFAULT_FILTERS, NOW)).toBeNull();
    expect(rangeFor(DEFAULT_FILTERS, NOW)).toBeNull();
  });
});

describe('counting what is on', () => {
  it('treats the whole category group as one decision', () => {
    // Ticking six activities is still ONE thing somebody chose, and a badge
    // reading "6" would suggest six separate things to go and undo.
    expect(activeFilterCount(withFilters({ categories: ['bar', 'club', 'beach'] }))).toBe(1);
  });

  it('does not count a category group that means the same as none', () => {
    const all = withFilters({
      categories: ['bar', 'restaurant', 'club', 'museum', 'monument', 'beach', 'hike', 'other'],
    });
    expect(activeFilterCount(all)).toBe(0);
  });

  it('adds up across groups', () => {
    expect(activeFilterCount(withFilters({ when: 'next7', kinds: ['travelers'] }))).toBe(2);
  });

  it('scores a custom range as ONE, so the badge and both Clear all buttons stay honest', () => {
    // One point for the `when`, nothing for the two days inside it: a range
    // is one decision, exactly as the category group is.
    expect(
      activeFilterCount(withFilters({ when: 'custom', from: '2026-09-01', to: '2026-09-14' }))
    ).toBe(1);
    expect(activeFilterCount(withFilters({ when: 'next30' }))).toBe(1);
    expect(isDefault(withFilters({ when: 'next7' }))).toBe(false);
  });

  it('has no verified-only filter to count', () => {
    // It was a second, weaker copy of the audience setting on the profile —
    // and that one cuts both ways and is enforced in the database, so having
    // both is how somebody narrows the map, believes they are hidden, and is
    // not. Founder asked for it gone.
    expect(Object.keys(DEFAULT_FILTERS)).not.toContain('verifiedOnly');
  });
});

describe('the date window', () => {
  it("anchors next 7 and next 30 days on the CITY's today", () => {
    // A device on the 28th browsing a city already into the 29th: the week
    // is the city's week. Read through rangeFor, the pair before any clock
    // tolerance, which is what the filter sheet prints.
    const city = new Date(2026, 7, 29, 3, 0);
    expect(rangeFor(withFilters({ when: 'next7' }), NOW, city)).toEqual({
      from: '2026-08-29',
      to: '2026-09-04',
    });
    expect(rangeFor(withFilters({ when: 'next30' }), NOW, city)).toEqual({
      from: '2026-08-29',
      to: '2026-09-27',
    });
  });

  it('a custom range comes back inclusive at both ends, a single tapped day standing for one day', () => {
    const custom = withFilters({ when: 'custom', from: '2026-09-01', to: '2026-09-14' });
    expect(rangeFor(custom, NOW)).toEqual({ from: '2026-09-01', to: '2026-09-14' });
    const window = windowFor(custom, NOW)!;
    expect(pinPasses(pin({ intent_date: '2026-09-01' }), custom, window)).toBe(true);
    expect(pinPasses(pin({ intent_date: '2026-09-14' }), custom, window)).toBe(true);
    expect(pinPasses(pin({ intent_date: '2026-08-30' }), custom, window)).toBe(false);
    expect(pinPasses(pin({ intent_date: '2026-09-16' }), custom, window)).toBe(false);
    // Mid-pick: one day tapped is one day.
    expect(rangeFor(withFilters({ when: 'custom', from: '2026-09-01', to: null }), NOW)).toEqual({
      from: '2026-09-01',
      to: '2026-09-01',
    });
    // Custom with nothing picked yet is not a window at all.
    expect(windowFor(withFilters({ when: 'custom' }), NOW)).toBeNull();
  });

  it('widens by the measured clock skew, and never by more than a day each way', () => {
    // intent_date is written by three clocks (the city's, the device's, and
    // Postgres's UTC current_date for the seed), so a boundary day can be
    // off by one. Asserted as a BOUND rather than as fixed strings, because
    // whether they differ depends on the runner's own timezone and a test
    // that only passes west of Greenwich is worse than no test.
    const custom = withFilters({ when: 'custom', from: '2026-09-01', to: '2026-09-14' });
    const window = windowFor(custom, NOW)!;
    expect(['2026-08-31', '2026-09-01']).toContain(window.from);
    expect(['2026-09-14', '2026-09-15']).toContain(window.to);
    const skew = clockSkew(NOW);
    expect(skew.before).toBeLessThanOrEqual(1);
    expect(skew.after).toBeLessThanOrEqual(1);
    // The two clocks cannot sit on opposite sides of the same day at once.
    expect(skew.before + skew.after).toBeLessThanOrEqual(1);
  });

  it('keeps a pin on the boundary day when the device and the city disagree', () => {
    // A device at 20:00 on the 30th browsing a city already at 03:00 on the
    // 31st: the city's week leads, and the device-written 30th (the same
    // night, on the other clock) stays matched. "Widen, never swap." This is
    // the failure that is silent and only reproduces in other timezones.
    const device = new Date(2026, 7, 30, 20, 0);
    const city = new Date(2026, 7, 31, 3, 0);
    const window = windowFor(withFilters({ when: 'next7' }), device, city)!;
    expect(inWindow('2026-08-31', window)).toBe(true); // the city's today
    expect(inWindow('2026-08-30', window)).toBe(true); // the device's today, still matched
    expect(inWindow('2026-09-06', window)).toBe(true); // the city's seventh day
    expect(inWindow('2026-08-28', window)).toBe(false);
    expect(inWindow('2026-09-09', window)).toBe(false);
  });

  it('hides a plan for another day', () => {
    const next7 = withFilters({ when: 'next7' });
    const window = windowFor(next7, NOW)!;
    expect(pinPasses(pin({ intent_date: '2026-08-20' }), next7, window)).toBe(false);
    expect(pinPasses(pin({ intent_date: '2026-08-30' }), next7, window)).toBe(true);
    expect(pinPasses(pin({ intent_date: '2026-10-01' }), next7, window)).toBe(false);
  });

  it("todayWindow leads with the city's day and keeps the device day matched", () => {
    // The plan list's "N today" reads this, so the peek cannot disagree with
    // the markers the map draws for the same day.
    const device = new Date(2026, 7, 30, 20, 0);
    const city = new Date(2026, 7, 31, 3, 0);
    const today = todayWindow(device, city);
    expect(inWindow('2026-08-31', today)).toBe(true);
    expect(inWindow('2026-08-30', today)).toBe(true);
    expect(inWindow('2026-08-28', today)).toBe(false);
    expect(inWindow('2026-09-02', today)).toBe(false);
  });
});

describe('who and what is on the map', () => {
  it('separates our own picks from other travelers', () => {
    const ours = pin({ seeded: true, user_id: null });
    expect(pinPasses(ours, withFilters({ kinds: ['travelers'] }), null)).toBe(false);
    expect(pinPasses(ours, withFilters({ kinds: ['picks'] }), null)).toBe(true);
    expect(pinPasses(pin(), withFilters({ kinds: ['picks'] }), null)).toBe(false);
  });

  it('never lets the last family be unticked', () => {
    // An empty map reads as broken rather than as filtered.
    expect(toggle(['travelers'], 'travelers', true)).toEqual(['travelers']);
    expect(toggle(['travelers', 'picks'], 'picks', true)).toEqual(['travelers']);
  });

  it('lets a category group empty, because empty means all', () => {
    expect(toggle(['bar'], 'bar')).toEqual([]);
  });

  it('never decides who you may see — the server already did', () => {
    // discovery_pair_ok settles it before these rows reach the device, keyed
    // to the pin's OWNER. An unverified traveler's pin is on this map because
    // the server said it could be, and the client must not second-guess that
    // — nor may a joiner on an open pin ever remove the pin from a map.
    expect(pinPasses(pin({ verified: false }), DEFAULT_FILTERS, null)).toBe(true);
    expect(pinPasses(pin({ verified: true }), DEFAULT_FILTERS, null)).toBe(true);
    expect(pinPasses(pin({ seeded: true, user_id: null }), DEFAULT_FILTERS, null)).toBe(true);
  });

  it('narrows by what the plan is', () => {
    const bars = withFilters({ categories: ['bar', 'club'] });
    expect(pinPasses(pin({ category: 'bar' }), bars, null)).toBe(true);
    expect(pinPasses(pin({ category: 'hike' }), bars, null)).toBe(false);
  });

  it('turns businesses off without touching the pins', () => {
    const noPlaces = withFilters({ kinds: ['travelers', 'picks'] });
    expect(showsBusinesses(noPlaces)).toBe(false);
    expect(pinPasses(pin(), noPlaces, null)).toBe(true);
  });
});

describe('the count the filter sheet prints', () => {
  it('is the filtered pins plus the places only while businesses are drawn', () => {
    // The same arithmetic the markers use, or the number contradicts the
    // dots the moment Businesses is unticked.
    expect(mapResultCount(3, 4, DEFAULT_FILTERS)).toBe(7);
    expect(mapResultCount(3, 4, withFilters({ kinds: ['travelers', 'picks'] }))).toBe(3);
    expect(mapResultCount(0, 0, DEFAULT_FILTERS)).toBe(0);
  });
});
