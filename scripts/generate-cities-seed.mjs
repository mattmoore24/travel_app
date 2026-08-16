#!/usr/bin/env node
/**
 * Regenerates supabase/migrations/*_seed_cities.sql from the GeoNames-derived
 * `all-the-cities` npm package (data license: CC BY 4.0, geonames.org).
 *
 * Usage:
 *   npm install --no-save all-the-cities
 *   node scripts/generate-cities-seed.mjs
 *
 * Committed output is the source of truth. IMPORTANT: once this migration
 * version has been applied to ANY environment, do NOT regenerate in place —
 * `on conflict do nothing` means applied rows never refresh. Write a NEW
 * migration (update OUT below with a fresh timestamp) for dataset updates.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cities = require('all-the-cities');

const POPULATION_MIN = 50_000;
const OUT = new URL('../supabase/migrations/20260816200100_seed_cities.sql', import.meta.url);

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

const esc = (s) => s.replace(/'/g, "''");

const rows = cities
  .filter((c) => c.population >= POPULATION_MIN)
  .sort((a, b) => a.cityId - b.cityId)
  .map((c) => {
    const [lng, lat] = c.loc.coordinates;
    const admin = c.adminCode ? `'${esc(String(c.adminCode))}'` : 'null';
    return `(${c.cityId},'${esc(c.name)}','${esc(c.country)}','${esc(countryName(c.country))}',${admin},${lat},${lng},${c.population})`;
  });

const BATCH = 500;
let sql = `-- GENERATED FILE — do not edit by hand; rerun scripts/generate-cities-seed.mjs.
-- City reference data derived from GeoNames (https://www.geonames.org/) via the
-- all-the-cities npm package. GeoNames data is licensed CC BY 4.0.
-- Population threshold: >= ${POPULATION_MIN.toLocaleString('en-US')} (${rows.length} cities).

`;
for (let i = 0; i < rows.length; i += BATCH) {
  sql += `insert into public.cities (id, name, country_code, country_name, admin, lat, lng, population) values\n${rows
    .slice(i, i + BATCH)
    .join(',\n')}\non conflict (id) do nothing;\n\n`;
}

writeFileSync(OUT, sql);
console.log(`wrote ${rows.length} cities to ${OUT.pathname}`);
