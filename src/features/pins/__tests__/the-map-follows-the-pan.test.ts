import fs from 'node:fs';
import path from 'node:path';

/**
 * The map follows the pan (founder, 2026-09-11), and the three things that
 * would quietly undo it are pinned here: the follow must not fly the camera
 * (the person is already looking at the city), a business must never
 * follow (its map is its own city), and a followed city must not summon the
 * way-home pill against the person who dragged the map there.
 */
const source = fs.readFileSync(path.join(__dirname, '..', 'map-screen.tsx'), 'utf8');

function between(start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = source.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

/** Prettier wraps long calls; the claim is about the words, not the line breaks. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('the map follows the pan', () => {
  it('asks the resolver from the settled region, gated by the shared predicate', () => {
    expect(source).toContain(
      "import { FOLLOW_SETTLE_MS, shouldFollowMap } from '@/features/pins/follow-the-map';"
    );
    const handler = between('onRegionChangeComplete={(region) => {', "if (mode === 'place') {");
    expect(flat(handler)).toContain(
      'shouldFollowMap( region, activeCity?.cities ?? null, region.latitudeDelta > CITY_ZOOM_DELTA )'
    );
    expect(handler).toContain('followTimer.current = setTimeout(');
    expect(handler).toContain('void followMap(region);');
  });

  it('never follows for a business, whose map is its own city', () => {
    const handler = between('onRegionChangeComplete={(region) => {', "if (mode === 'place') {");
    expect(flat(handler)).toContain("mode === 'browse' && !isBusiness &&");
  });

  it('marks the followed city before choosing it, and the fit effect consumes its key without a flight', () => {
    const follow = between('const followMapTo = (row: CityRow) => {', '  };');
    const marked = follow.indexOf('setFollowedCityId(city.city_id);');
    const chosen = follow.indexOf('chooseCity(city);');
    expect(marked).toBeGreaterThan(-1);
    expect(chosen).toBeGreaterThan(marked);
    // Inside the effect: the key is consumed first, then the flight is
    // skipped for a followed city, so the next filter change still frames.
    const effect = between(
      'const key = fitKeyFor(activeCityId, filters);',
      'mapRef.current?.animateToRegion(region'
    );
    const consumed = effect.indexOf('lastFitKey.current = key;');
    const skipped = effect.indexOf('if (followedCityId === activeCityId) {');
    expect(consumed).toBeGreaterThan(-1);
    expect(skipped).toBeGreaterThan(consumed);
  });

  it('asks with the browsed city as the hint and keeps the map on a refusal', () => {
    const ask = between('const followMap = async (centre', '  };');
    expect(flat(ask)).toContain(
      'fetchCityForSpot( centre.latitude, centre.longitude, activeCityIdRef.current )'
    );
    expect(ask).toContain('row.id !== activeCityIdRef.current');
    expect(ask).toContain('} catch {');
  });

  it('keeps the way-home pill off a followed city, and a chosen city clears that', () => {
    expect(source).toContain("'way-home': farFromCity && followedCityId !== activeCityId,");
    const apply = between('const applyCity = (city: BrowseCity) => {', '  };');
    expect(apply).toContain('setFollowedCityId(null);');
  });
});
