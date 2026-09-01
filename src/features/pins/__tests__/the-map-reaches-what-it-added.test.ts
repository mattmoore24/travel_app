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

  it('asks for the counts and prints one inside each chip', () => {
    expect(map).toContain('useCityPinCounts()');
    // Found by city, not by index: the rail and the counts are two queries
    // and nothing guarantees they arrive in the same order.
    expect(map).toContain('cityCounts.find((row) => row.city_id === city.city_id)?.pin_count');
    expect(map).toMatch(/type="caption"[\s\S]{0,160}\{count\}/);
  });

  it('never draws a count the server withheld', () => {
    // null is the answer below a city's own k, and it has to stay an
    // absence rather than becoming a zero on the chip.
    expect(map).toContain('{count != null ? (');
  });

  it('carries a fifth chip for the cities nobody has opened', () => {
    expect(map).toContain('Somewhere else?');
    expect(map).toContain('setCityRequestOpen(true)');
  });

  it('and that chip opens something that actually records the city', () => {
    expect(map).toContain('useRequestCity()');
    expect(map).toContain('requestCity.mutateAsync(name)');
    // The demand map is the point; a sheet that only says "not yet" is the
    // thing this package exists to replace.
    expect(map).toContain('city-request-input');
  });

  it('promises only what the app can do', () => {
    // No notify-me worker exists, so the sheet must not say it will tell
    // anybody anything.
    const sheet = map.slice(map.indexOf('We open cities where'), map.indexOf('Ask for it'));
    expect(sheet).not.toMatch(/we will (tell|let you know|email)/i);
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
    // And the empty chip must not say "nothing here" over a glow.
    expect(map).toMatch(
      /heatEmptyLegend = useHeatEmptyLegend\([\s\S]{0,400}historyCells\.length === 0/
    );
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
