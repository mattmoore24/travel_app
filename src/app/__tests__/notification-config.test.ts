import fs from 'node:fs';
import path from 'node:path';

import { between } from '@/lib/__tests__/source';

/**
 * The one thing a config plugin can get wrong for free, and the one thing it
 * cannot.
 *
 * There is no unit test for a config plugin: the evidence that push arrives
 * styled the way it is declared is a build, an install and a banner. What CAN
 * be checked here is the failure that costs an EAS build to discover, and
 * builds draw down real credit on the Starter plan: an `icon` path pointing at
 * an asset that is not in the repo fails the prebuild rather than failing
 * quietly, several minutes into a run.
 *
 * The option NAMES are read off expo-notifications' own plugin types
 * (plugin/build/withNotifications.d.ts in the installed 57.0.11), not
 * recalled: icon, color, defaultChannel, sounds, mode,
 * enableBackgroundRemoteNotifications.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const appJson = JSON.parse(fs.readFileSync(path.join(REPO, 'app.json'), 'utf8')) as {
  expo: {
    plugins: (string | [string, Record<string, unknown>])[];
    ios?: { entitlements?: Record<string, unknown> };
  };
};

const entry = appJson.expo.plugins.find(
  (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-notifications'
);

describe('the notification config', () => {
  it('is declared at all, which it was not while push.ts registered tokens', () => {
    expect(entry).toBeDefined();
  });

  it('names an icon that is actually in the repo', () => {
    const icon = entry?.[1].icon as string;
    expect(icon).toBe('./assets/images/notification-icon.png');
    expect(fs.existsSync(path.join(REPO, icon))).toBe(true);
  });

  it('uses only option names the installed plugin understands', () => {
    const known = new Set([
      'icon',
      'color',
      'defaultChannel',
      'sounds',
      'mode',
      'enableBackgroundRemoteNotifications',
    ]);
    expect(Object.keys(entry?.[1] ?? {}).filter((k) => !known.has(k))).toEqual([]);
  });

  it('asks for the production APNs entitlement rather than taking the default', () => {
    // The one option here that is about iOS, and the only one whose default
    // is wrong for a build that goes to TestFlight. withNotificationsIOS.js:9
    // in the installed 57.0.11 destructures `{ mode = 'development' }` and
    // :11-12 writes it straight into `aps-environment`; this app config has
    // no `ios.entitlements` block, so nothing else pre-sets that key and the
    // default is what would ship. A binary carrying `aps-environment:
    // development` registers against the APNs SANDBOX: registration returns a
    // token, the token looks fine, and delivery never happens - which is
    // indistinguishable from every other bug in this subsystem.
    //
    // Expo's own SDK 57 notes say Xcode rewrites the value from the
    // provisioning profile when it archives a release build, so this may well
    // be belt as well as braces. It is not established from this machine
    // either way (docs/APP_STORE.md, "The APNs entitlement"), and the failure
    // it guards against is silent while the failure it could cause is a build
    // error you can read.
    expect(entry?.[1].mode).toBe('production');
    expect(appJson.expo.ios?.entitlements).toBeUndefined();
  });

  it('names an Android channel that something in this repo actually creates', () => {
    // `defaultChannel` writes
    // `com.google.firebase.messaging.default_notification_channel_id` into
    // the manifest (withNotificationsAndroid.js in the installed 57.0.11). It
    // NAMES a channel; it does not create one. Nothing here called
    // setNotificationChannelAsync, so the id pointed at nothing and Android
    // fell back to a channel of its own making — the same defect as an icon
    // path with no file behind it, in a smaller box and without the build
    // error to find it by.
    const channel = entry?.[1].defaultChannel;
    expect(channel).toBe('default');
    const push = fs.readFileSync(
      path.join(REPO, 'src', 'features', 'notifications', 'push.ts'),
      'utf8'
    );
    expect(push).toContain(`const ANDROID_CHANNEL = '${channel as string}'`);
    expect(push).toContain('Notifications.setNotificationChannelAsync(ANDROID_CHANNEL');
    // On the path that runs on every launch that already has permission, not
    // only the one behind the primer's prompt.
    //
    // `between`, not `after`: an unbounded slice runs to end of file, so the
    // call satisfied this assertion from ANYWHERE below storeToken's
    // declaration — including from a function storeToken never reaches, which
    // is exactly the arrangement the comment above rules out.
    expect(
      between(push, 'async function storeToken(', 'export async function pushPermissionGranted(')
    ).toContain('await ensureAndroidChannel();');
  });

  it('tints with a foreground colour rather than the canvas', () => {
    // Android tints the small icon with this and draws it on a shade that
    // follows the system theme, so the app's near-black ground would be a
    // dark blob on a dark shade — the same grey square an undeclared icon
    // gives. #8AA6F0 is the accent token, 7.9:1 on the app's own ground.
    expect(entry?.[1].color).toBe('#8AA6F0');
  });
});
