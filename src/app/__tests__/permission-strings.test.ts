import fs from 'node:fs';
import path from 'node:path';

/**
 * The permission dialogs are the only sentences this app shows that are not
 * in `src/`, and they are the only ones that cannot be fixed over the air:
 * they are compiled into the binary at prebuild, so a mistake here waits for
 * a whole EAS build and a TestFlight round trip.
 *
 * Two copies of every string exist on purpose. The `expo-image-picker` plugin
 * block writes the base `Info.plist` values, which is what a device with no
 * matching localisation falls back to; `locales/en.json` is read at prebuild
 * and written into `en.lproj/InfoPlist.strings`, which is what an English
 * device actually reads. Both have to say the same thing, and nothing else in
 * the toolchain notices when they stop.
 *
 * The quote rule is not style. `@expo/config-plugins`'
 * `build/ios/Locales.js` writes `KEY = "value";` with no escaping, so one
 * double quote in the copy produces a strings file that does not parse and a
 * permission sheet that falls back to nothing.
 */

const ROOT = path.join(__dirname, '..', '..', '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

/** The plugin entry, found by name rather than by index. */
function pluginConfig(name: string): Record<string, unknown> {
  const entry = (appConfig.expo.plugins as (string | [string, Record<string, unknown>])[]).find(
    (p) => Array.isArray(p) && p[0] === name
  );
  if (!Array.isArray(entry)) {
    throw new Error(`app.json has no configured ${name} plugin`);
  }
  return entry[1];
}

const picker = pluginConfig('expo-image-picker');
const location = pluginConfig('expo-location');

describe('the permission dialogs', () => {
  it('declares a locale, so a second language is a file rather than a rewrite', () => {
    expect(appConfig.expo.locales).toEqual({ en: './locales/en.json' });
    // Without this, iOS reads only the base Info.plist and the .lproj is
    // decoration.
    expect(appConfig.expo.ios.infoPlist.CFBundleAllowMixedLocalizations).toBe(true);
  });

  const localePath = path.join(ROOT, 'locales', 'en.json');

  it('points at a file that exists, because a missing one is only a warning', () => {
    // getResolvedLocalesAsync catches the read and warns, so a typo here does
    // not fail a build: it ships an app with no localised permission text and
    // says so in a line nobody reads.
    expect(fs.existsSync(localePath)).toBe(true);
  });

  const strings: Record<string, string> = JSON.parse(fs.readFileSync(localePath, 'utf8'));

  it.each([
    ['NSCameraUsageDescription', picker.cameraPermission],
    ['NSPhotoLibraryUsageDescription', picker.photosPermission],
    ['NSMotionUsageDescription', location.motionUsagePermission],
  ])('says the same thing in %s as in the plugin block', (key, inline) => {
    expect(strings[key]).toBe(inline);
  });

  it.each(Object.entries(strings))('%s survives the strings-file generator', (_key, value) => {
    expect(value).not.toContain('"');
  });

  it.each(Object.entries(strings))('%s reads like the rest of the app', (_key, value) => {
    // The design brief's rules, applied to the strings a person meets before
    // they have seen a single screen.
    expect(value).not.toContain('—');
    expect(value).not.toMatch(/\b(swipe|deck|match|unmatch)\b/i);
    // A permission sheet that says "near you" is a presence claim in an app
    // whose strongest promise is that it never reads your location.
    expect(value).not.toMatch(/\b(near you|nearby|here now)\b/i);
  });
});
