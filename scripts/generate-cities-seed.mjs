#!/usr/bin/env node
/**
 * Regenerates the city reference data from the GeoNames-derived
 * `all-the-cities` npm package (data license: CC BY 4.0, geonames.org), with
 * each city's IANA zone looked up from its coordinates by `geo-tz`.
 *
 * Usage:
 *   npm install --no-save all-the-cities geo-tz
 *   node scripts/generate-cities-seed.mjs --min 5000 \
 *     --out supabase/migrations/<timestamp>_seed_cities_<what>.sql
 *
 * Committed output is the source of truth. IMPORTANT: once a seed migration
 * has been applied to ANY environment, do NOT regenerate it in place — write a
 * NEW migration for a dataset update. The statement emitted is
 * `on conflict (id) do update set timezone = excluded.timezone`, so a rerun
 * into a new file refreshes every city's clock and adds the cities the lower
 * threshold admits, and never rewrites a name or a coordinate a live row
 * already carries (trips and pins point at those rows).
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const cities = require('all-the-cities');
const { find: findZones } = require('geo-tz');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] != null ? args[at + 1] : fallback;
};
const POPULATION_MIN = Number(flag('--min', '50000'));
const OUT = resolve(
  process.cwd(),
  flag('--out', 'supabase/migrations/20260816200100_seed_cities.sql')
);

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

const esc = (s) => s.replace(/'/g, "''");

// One zone per city: geo-tz answers with every zone whose polygon contains
// the point (disputed borders return two). The first is the canonical one.
const zoneFor = (lat, lng) => {
  try {
    return findZones(lat, lng)[0] ?? null;
  } catch {
    return null;
  }
};

const rows = cities
  .filter((c) => c.population >= POPULATION_MIN)
  .sort((a, b) => a.cityId - b.cityId)
  .map((c) => {
    const [lng, lat] = c.loc.coordinates;
    const admin = c.adminCode ? `'${esc(String(c.adminCode))}'` : 'null';
    const zone = zoneFor(lat, lng);
    const tz = zone ? `'${esc(zone)}'` : 'null';
    return `(${c.cityId},'${esc(c.name)}','${esc(c.country)}','${esc(countryName(c.country))}',${admin},${lat},${lng},${c.population},${tz})`;
  });

const BATCH = 500;
let sql = `-- GENERATED FILE — do not edit by hand; rerun scripts/generate-cities-seed.mjs.
-- City reference data derived from GeoNames (https://www.geonames.org/) via the
-- all-the-cities npm package. GeoNames data is licensed CC BY 4.0. Each city's
-- IANA zone comes from geo-tz (its coordinate against the tz boundary set).
-- Population threshold: >= ${POPULATION_MIN.toLocaleString('en-US')} (${rows.length} cities).
--
-- New rows are inserted whole; a row that already exists keeps its name and
-- coordinates (trips and pins point at them) and only learns its clock.

`;
for (let i = 0; i < rows.length; i += BATCH) {
  sql += `insert into public.cities (id, name, country_code, country_name, admin, lat, lng, population, timezone) values\n${rows
    .slice(i, i + BATCH)
    .join(',\n')}\non conflict (id) do update set timezone = excluded.timezone;\n\n`;
}

writeFileSync(OUT, sql);
console.log(`wrote ${rows.length} cities to ${OUT}`);
