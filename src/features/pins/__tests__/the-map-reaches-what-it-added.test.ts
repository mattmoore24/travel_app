import fs from 'node:fs';
import path from 'node:path';

/**
 * EVERY CAPABILITY IN THIS BATCH HAS A CALL SITE, and this is a source scan
 * because that is the only way to see the defect.
 *
 * The failures this repo has paid for lately all share one shape: a screen
 * with no entry point, a component mounted nowhere, an option defaulted off
 * that no caller sets, a queue no worker drains, a table with no client.
 * Every one of them passed a green unit suite, because a test that renders a
 * component proves the component works and says nothing at all about whether
 * anybody can reach it.
 *
 * map-screen.tsx is 3,500 lines and forty hooks deep, so mounting it here
 * would be a mock of the whole app rather than a test. What can be checked
 * cheaply and exactly is that each new thing is REFERENCED where it has to
 * be, by the name it has to be referenced by. It is a weak assertion about
 * behaviour and a strong one about wiring, which is the half that keeps
 * going wrong.
 *
 * The behaviour lives elsewhere and on purpose: the hour's rules in
 * a-pin-carries-an-hour.test.ts and pin-form-hour.test.tsx, and everything
 * the database enforces in supabase/tests/database/56_a_pin_carries_an_hour.
 */
const FEATURE = path.join(__dirname, '..');

function read(file: string): string {
  return fs.readFileSync(path.join(FEATURE, file), 'utf8');
}

describe('the city rail', () => {
  const map = read('map-screen.tsx');

  it('draws the rail the server ranks, and prints each count inside its chip', () => {
    // featured_cities(): the launch cities plus any city whose visible plans
    // clear its k, most plans first, each row carrying its own count - one
    // query, so the chip and its number cannot arrive in different orders.
    expect(map).toContain('useFeaturedCities()');
    expect(map).toContain('{railCities.map((city) => {');
    expect(map).toContain('const count = city.pin_count;');
    expect(map).toMatch(/type="caption"[\s\S]{0,160}\{count\}/);
  });

  it('never draws a count the server withheld', () => {
    // null is the answer below a city's own k, and it has to stay an
    // absence rather than becoming a zero on the chip.
    expect(map).toContain('{count != null ? (');
  });

  it('puts the browsed city on the rail when it is not one of the featured', () => {
    // A city reached by search, or by a pin that landed a continent away,
    // still needs a lit chip.
    expect(map).toContain('[activeCity, ...featured]');
  });

  it('carries a search chip, and nobody has to ask for a city', () => {
    expect(map).toContain('accessibilityLabel="Search for a city"');
    expect(map).toContain('setCitySearchOpen(true)');
    expect(map).toContain('city-search-input');
    expect(map).toContain("useCitySearch(citySearchOpen ? cityQuery : '')");
    // The request-a-city flow is gone with its function (20260904120000).
    expect(map).not.toContain('Somewhere else?');
    expect(map).not.toContain('useRequestCity');
    expect(read('hooks.ts')).not.toContain('request_city');
  });

  it('a search pick browses that city through the same door a chip does', () => {
    // selectCity, so the switch is counted and persisted exactly like a tap
    // on a chip: a city found by search is a choice the person made.
    expect(map).toContain('selectCity(browseCityFromCityRow(row));');
  });

  it('follows a pin to the city it resolved to', () => {
    // Dropped in Manhattan while the Bangkok chip was lit, the pin belongs
    // to New York; the map goes where the pin went rather than showing a
    // confirmation card for a plan it is not drawing.
    expect(map).toContain('onPosted={(pinId, city) => {');
    expect(map).toContain('applyCity(browseCityFromCityRow(city));');
    expect(read('hooks.ts')).toContain('city_id: city?.id ?? input.cityId,');
  });
});

describe('the remembered heat layer', () => {
  const map = read('map-screen.tsx');

  it('is asked for and drawn, not merely fetched', () => {
    expect(map).toContain('useHeatHistory(activeCityId)');
    expect(map).toContain('drawnHistoryCells.map((cell) => (');
  });

  it('is drawn beneath the live layer, never over it', () => {
    expect(map.indexOf('drawnHistoryCells.map')).toBeLessThan(
      map.indexOf('heatRings(cell).map((ring) => (')
    );
  });

  it('is turned off by the same control that turns the live layer off', () => {
    // The filter sheet is not this package's file, so the remembered layer
    // rides the Busy areas toggle rather than inventing a second one nobody
    // can reach.
    expect(map).toMatch(/drawnHistoryCells = useMemo\(\(\) => \{\s*if \(!heatShown\)/);
  });

  it('never says "the plans are" over a layer that is a memory', () => {
    expect(map).toContain('Dimmer spots are where this city is usually busy');
    // The "not busy enough to show yet" chip that used to carry the second
    // half of this rule is gone (founder, 2026-09-03): a quiet city says so
    // through the empty-city card, and the map no longer narrates an absence.
    expect(map).not.toContain('Not busy enough to show yet');
  });

  it('asks the server for nothing it could get wrong', () => {
    // No weekday, no hour band, no k: the server owns all three (§7 rule 6),
    // and an option defaulted off is the failure this batch is named after.
    const hook = read('hooks.ts');
    expect(hook).toContain("callRpc('heat_history_cells', { p_city_id: cityId! })");
  });
});

describe('a plan that names a business', () => {
  const map = read('map-screen.tsx');

  it('offers the way into that business from the pin card', () => {
    expect(map).toContain('See the business');
    expect(map).toContain('onOpenBusiness(pin.business_id!)');
  });

  it('and the map answers it by swapping one card for the other', () => {
    expect(map).toMatch(
      /onOpenBusiness=\{\(businessId\) => \{[\s\S]{0,400}setSelectedPlaceId\(businessId\)/
    );
  });
});

describe('the hour', () => {
  it('leaves the form on the pin, not after it', () => {
    // Pins are immutable, so a second write could never add one.
    expect(read('pin-form-sheet.tsx')).toContain('intentTime: effectiveTime || null');
    expect(read('hooks.ts')).toContain('p_intent_time: input.intentTime ?? null');
  });

  it('reaches every surface that says when a plan is', () => {
    const map = read('map-screen.tsx');
    // The card, the marker's spoken label, and the venue stack's rows.
    expect(map.match(/whenLabel\(pin, /g) ?? []).toHaveLength(3);
    expect(map).toContain('[...openVenue.pins].sort(byIntentMoment)');
  });
});
