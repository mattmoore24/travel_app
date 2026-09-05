import fs from 'node:fs';
import path from 'node:path';

import { ROOT, repoPath, sourceFiles, withoutComments } from '../source-scan';

/**
 * §7 rule 2: **no real-time user location is ever collected, stored or
 * displayed.** It is the strongest claim this product makes, the one the
 * privacy screen leads with ("We never collect your location"), and the one
 * sentence in the App Review notes that a reviewer can check.
 *
 * Today that claim rests on attention. `expo-location` is a dependency —
 * three screens geocode with it — so nothing stops a future call site from
 * adding one line and turning the claim into a lie. Two things then happen,
 * and the second is worse than the first:
 *
 * 1. The app starts collecting a position, which is the rule broken.
 * 2. It CRASHES. `app.json` sets every one of expo-location's iOS usage
 *    strings to `false` on purpose, so the built app carries no
 *    `NSLocationWhenInUseUsageDescription`, and iOS terminates a process that
 *    asks for a permission it has not declared. Not a refused prompt, not a
 *    degraded feature: a hard crash, for everybody, discovered in TestFlight.
 *
 * So this is a source scan, modelled on the one in
 * `src/lib/__tests__/live-camera.test.ts:108-141`. Geocoding is the only
 * thing this app may ever ask expo-location for, and geocoding is not
 * location: `geocodeAsync` turns typed words into a point and
 * `reverseGeocodeAsync` turns a point the user DRAGGED A MARKER TO into a
 * street name. Neither one reads the device.
 *
 * The three call sites today, all geocoding-only:
 *   - src/features/pins/map-screen.tsx    reverseGeocodeAsync (dropped pin)
 *   - src/features/pins/pin-form-sheet.tsx reverseGeocodeAsync (pin address)
 *   - src/features/pins/use-place-search.ts geocodeAsync      (place search)
 *
 * Related, and deliberately elsewhere: `src/features/pins/browsing-city.ts`
 * answers "which city is this traveler browsing" from a tap, their typed
 * trips and the device CLOCK ZONE, and
 * `src/features/pins/__tests__/city-store.test.ts:77` keeps expo-location out
 * of that file specifically. This scan is the same rule for the whole tree.
 */

/** The only two expo-location functions this app may ever call. */
const GEOCODING_ONLY = ['geocodeAsync', 'reverseGeocodeAsync'] as const;

/**
 * Everything else expo-location exports, written out rather than derived, so
 * the rule is READABLE here — the point of a scan is that somebody opening it
 * learns what is forbidden. `stays complete` below re-derives the list from
 * the installed package on every run, so this cannot quietly go stale when an
 * SDK bump adds a new way to read a phone's position.
 */
const FORBIDDEN_EXPORTS = [
  'enableNetworkProviderAsync',
  'getBackgroundPermissionsAsync',
  'getCurrentPositionAsync',
  'getForegroundPermissionsAsync',
  'getHeadingAsync',
  'getLastKnownPositionAsync',
  'getMotionActivityAsync',
  'getMotionActivityPermissionsAsync',
  'getProviderStatusAsync',
  'hasServicesEnabledAsync',
  'hasStartedGeofencingAsync',
  'hasStartedLocationUpdatesAsync',
  'isBackgroundLocationAvailableAsync',
  'requestBackgroundPermissionsAsync',
  'requestForegroundPermissionsAsync',
  'requestMotionActivityPermissionsAsync',
  'startGeofencingAsync',
  'startLocationUpdatesAsync',
  'stopGeofencingAsync',
  'stopLocationUpdatesAsync',
  'watchHeadingAsync',
  'watchMotionActivityAsync',
  'watchPositionAsync',
] as const;

const LOCATION_TYPES = path.join(ROOT, 'node_modules', 'expo-location', 'build', 'Location.d.ts');

const WHAT_TO_DO =
  'Only geocodeAsync and reverseGeocodeAsync are allowed (PRODUCT_BRIEF §7 rule 2: the app never ' +
  'reads the device position). If you need to know which city somebody is looking at, ask ' +
  'src/features/pins/browsing-city.ts, which answers it from their chip choice, their typed trips ' +
  'and the device clock zone. There is no permission string for location in app.json, so a call ' +
  'to a permission API does not degrade, it terminates the app on launch of the prompt.';

type Finding = string;

/** Every `<name> from 'expo-location'` import in one file, already stripped. */
function importsOf(code: string): { kind: 'namespace' | 'named' | 'other'; text: string }[] {
  const out: { kind: 'namespace' | 'named' | 'other'; text: string }[] = [];
  const statements = code.match(/import[^;]*?from\s*'expo-location'/g) ?? [];
  for (const statement of statements) {
    if (/import\s+\*\s+as\s+\w+\s+from/.test(statement))
      out.push({ kind: 'namespace', text: statement });
    else if (/import\s+(?:type\s+)?\{[^}]*\}\s+from/.test(statement))
      out.push({ kind: 'named', text: statement });
    else out.push({ kind: 'other', text: statement });
  }
  // `require('expo-location')` and `await import('expo-location')` cannot be
  // read by the two branches above, so they are their own finding rather than
  // a silent pass.
  for (const dynamic of code.match(/(?:require|import)\s*\(\s*'expo-location'\s*\)/g) ?? []) {
    out.push({ kind: 'other', text: dynamic });
  }
  return out;
}

function scan(file: string): Finding[] {
  const code = withoutComments(fs.readFileSync(file, 'utf8'));
  if (!code.includes('expo-location')) return [];
  const where = repoPath(file);
  const findings: Finding[] = [];
  // One line of source is one finding. The belt below re-covers everything the
  // import analysis already caught, and a failure that says the same thing
  // twice is a failure people skim.
  const reported = new Set<string>();

  for (const statement of importsOf(code)) {
    if (statement.kind === 'other') {
      findings.push(
        `${where}: cannot read \`${statement.text.trim()}\`. Import expo-location as ` +
          `\`import * as Location from 'expo-location'\` or with a named import, so this scan can ` +
          `see what is being used. ${WHAT_TO_DO}`
      );
      continue;
    }
    if (statement.kind === 'named') {
      const names = (/\{([^}]*)\}/.exec(statement.text)?.[1] ?? '')
        .split(',')
        .map((n) =>
          n
            .replace(/^\s*type\s+/, '')
            .split(/\s+as\s+/)[0]
            .trim()
        )
        .filter(Boolean);
      for (const name of names) {
        if (!(GEOCODING_ONLY as readonly string[]).includes(name)) {
          reported.add(name);
          findings.push(`${where}: imports \`${name}\` from expo-location. ${WHAT_TO_DO}`);
        }
      }
      continue;
    }
    const alias = /import\s+\*\s+as\s+(\w+)\s+from/.exec(statement.text)?.[1];
    if (!alias) continue;
    const uses = code.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'));
    for (const use of uses) {
      if (!(GEOCODING_ONLY as readonly string[]).includes(use[1])) {
        reported.add(use[1]);
        findings.push(`${where}: calls \`${alias}.${use[1]}\`. ${WHAT_TO_DO}`);
      }
    }
  }

  // The belt under the import analysis: the forbidden names are unique enough
  // to expo-location that seeing one anywhere in the app's source is the
  // finding, however it arrived — a re-export, a native module, a hand-rolled
  // bridge. `navigator.geolocation` is here for the same reason: expo-location
  // ships a polyfill for it (build/GeolocationPolyfill.js), and reaching for
  // the web API is exactly how somebody would sidestep an import rule.
  for (const name of [...FORBIDDEN_EXPORTS, 'navigator.geolocation']) {
    if (code.includes(name) && !reported.has(name)) {
      findings.push(`${where}: mentions \`${name}\` in code. ${WHAT_TO_DO}`);
    }
  }
  return findings;
}

describe('the app never reads the device position', () => {
  const files = sourceFiles();

  it('finds the source to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('asks expo-location for geocoding and nothing else, anywhere under src/', () => {
    expect(files.flatMap(scan)).toEqual([]);
  });

  // Not decoration: a scan whose subject has quietly disappeared passes
  // forever and proves nothing, so this says the three known call sites are
  // still there and still geocoding.
  //
  // `arrayContaining`, not an exact list, on purpose. A FOURTH geocoding call
  // site is legitimate — a business address, a second search field — and the
  // scan above already governs what it may do. Failing on the arrival of
  // correct code is how a scan earns its way out of the build.
  it('still has the geocoding call sites it was written for', () => {
    const users = files.filter((file) =>
      withoutComments(fs.readFileSync(file, 'utf8')).includes("from 'expo-location'")
    );
    expect(users.map(repoPath)).toEqual(
      expect.arrayContaining([
        'src/features/pins/map-screen.tsx',
        'src/features/pins/pin-form-sheet.tsx',
        'src/features/pins/use-place-search.ts',
      ])
    );
  });

  it('keeps the forbidden list complete against the installed expo-location', () => {
    const declared = [
      ...fs.readFileSync(LOCATION_TYPES, 'utf8').matchAll(/^export declare function (\w+)/gm),
    ].map((m) => m[1]);
    // If this fails because the package moved its types, fix the path — do not
    // delete the check. It is the only thing standing between an SDK bump that
    // adds `getPreciseLocationAsync` and a scan that silently stops covering it.
    expect(declared).toEqual(expect.arrayContaining([...GEOCODING_ONLY]));
    const missing = declared.filter(
      (name) =>
        !(GEOCODING_ONLY as readonly string[]).includes(name) &&
        !(FORBIDDEN_EXPORTS as readonly string[]).includes(name)
    );
    expect(missing).toEqual([]);
  });
});

/**
 * The other half of the crash, and the reason this file asserts on app.json.
 *
 * A source scan can only see the code that exists. What makes the FAILURE
 * loud rather than quiet is that the binary carries no location usage
 * description: iOS terminates an app that asks for a permission it has not
 * declared, so a location call cannot ship as a feature nobody noticed. Those
 * three `false` values are load-bearing privacy configuration, not an
 * oversight waiting to be tidied up.
 *
 * `motionUsagePermission` is the exception and stays a real sentence: some
 * library in the graph refers to the motion tools, Apple requires the notice
 * for the reference alone, and the string says exactly that.
 */
describe('the built app declares no reason to want a location', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

  const locationPlugin = (): Record<string, unknown> => {
    const plugins: unknown[] = config.expo.plugins;
    const entry = plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location'
    ) as [string, Record<string, unknown>] | undefined;
    expect(entry).toBeDefined();
    return entry![1];
  };

  it.each([
    'locationAlwaysAndWhenInUsePermission',
    'locationAlwaysPermission',
    'locationWhenInUsePermission',
  ])('leaves %s off, so there is no usage string to prompt with', (key) => {
    expect(locationPlugin()[key]).toBe(false);
  });
});
