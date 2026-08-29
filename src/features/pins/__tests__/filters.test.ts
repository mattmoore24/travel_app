import {
  DEFAULT_FILTERS,
  activeFilterCount,
  daysFor,
  heatDay,
  isDefault,
  pinPasses,
  showsBusinesses,
  toggle,
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

  it('asks the heat RPC about no day in particular', () => {
    expect(heatDay('any', NOW)).toBeNull();
    expect(daysFor('any', NOW)).toBeNull();
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
    expect(activeFilterCount(withFilters({ day: 'today', kinds: ['travelers'] }))).toBe(2);
  });

  it('has no verified-only filter to count', () => {
    // It was a second, weaker copy of the audience setting on the profile —
    // and that one cuts both ways and is enforced in the database, so having
    // both is how somebody narrows the map, believes they are hidden, and is
    // not. Founder asked for it gone.
    expect(Object.keys(DEFAULT_FILTERS)).not.toContain('verifiedOnly');
  });
});

describe('the day filter', () => {
  it('accepts either clock’s idea of the day', () => {
    // intent_date is written by whichever clock the sender was on, so around
    // midnight a phone and the server disagree about what "today" is and the
    // set carries both. Asserted as a bound rather than as exactly two,
    // because whether they differ depends on the runner's own timezone and a
    // test that only passes west of Greenwich is worse than no test.
    const days = daysFor('today', NOW)!;
    expect(days.has('2026-08-28')).toBe(true);
    expect(days.size).toBeGreaterThanOrEqual(1);
    expect(days.size).toBeLessThanOrEqual(2);
  });

  it('reaches exactly as far as a pin can', () => {
    // Three days is the whole universe: a pin is capped at 72 hours.
    expect([...daysFor('today', NOW)!]).toContain('2026-08-28');
    expect([...daysFor('tomorrow', NOW)!]).toContain('2026-08-29');
    expect([...daysFor('later', NOW)!]).toContain('2026-08-30');
  });

  it('hides a plan for another day', () => {
    const days = daysFor('tomorrow', NOW);
    expect(
      pinPasses(pin({ intent_date: '2026-08-28' }), withFilters({ day: 'tomorrow' }), days)
    ).toBe(false);
    expect(
      pinPasses(pin({ intent_date: '2026-08-29' }), withFilters({ day: 'tomorrow' }), days)
    ).toBe(true);
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
