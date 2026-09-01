import * as ImagePicker from 'expo-image-picker';
import fs from 'node:fs';
import path from 'node:path';
import { Platform } from 'react-native';

import { captureBlockedMessage, captureLivePhoto } from '@/lib/live-camera';

jest.mock('expo-image-picker', () => ({
  __esModule: true,
  CameraType: { front: 'front', back: 'back' },
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  // Deliberately present. If a screen ever reaches for it the call would
  // succeed silently in the app; here it would return undefined and the test
  // below would still not catch it, which is why the source scan exists.
  launchImageLibraryAsync: jest.fn(),
}));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

const granted = () =>
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true } as never);

describe('captureLivePhoto', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });

  it('returns the shot the camera took', async () => {
    granted();
    picker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///live.jpg' }],
    } as never);
    await expect(captureLivePhoto()).resolves.toEqual({
      kind: 'captured',
      uri: 'file:///live.jpg',
    });
  });

  // The whole point. A refused camera used to mean "open the library
  // instead", which made the badge meaningless for exactly the people most
  // motivated to refuse.
  it('reports a refused camera rather than reaching for the library', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false } as never);
    await expect(captureLivePhoto()).resolves.toEqual({ kind: 'denied' });
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('says so on web instead of asking for a permission that will not come', async () => {
    Platform.OS = 'web';
    await expect(captureLivePhoto()).resolves.toEqual({ kind: 'unavailable' });
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('treats backing out of the camera as nothing to say', async () => {
    granted();
    picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null } as never);
    await expect(captureLivePhoto()).resolves.toEqual({ kind: 'cancelled' });
  });

  // A selfie wants the front camera and a 4:5 crop; the storefront shots want
  // neither, because a crop tool is how you cut the street out of a wide shot.
  it('passes only the options it was given', async () => {
    granted();
    picker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///a.jpg' }],
    } as never);

    await captureLivePhoto({ front: true, allowsEditing: true, aspect: [4, 5] });
    expect(picker.launchCameraAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      quality: 1,
      cameraType: 'front',
      allowsEditing: true,
      aspect: [4, 5],
    });

    await captureLivePhoto();
    expect(picker.launchCameraAsync).toHaveBeenLastCalledWith({
      mediaTypes: ['images'],
      quality: 1,
    });
  });

  it('has a sentence for each way the camera can be out of reach, and none for the rest', () => {
    expect(captureBlockedMessage({ kind: 'denied' })).toContain('library');
    expect(captureBlockedMessage({ kind: 'unavailable' })).toContain('camera');
    expect(captureBlockedMessage({ kind: 'cancelled' })).toBeNull();
    expect(captureBlockedMessage({ kind: 'captured', uri: 'x' })).toBeNull();
  });
});

// Founder, 2026-08-27: "make sure that no verification for individuals or
// businesses allows the user to use saved photos as the whole point is to
// force the user to verify with a new photo taken at the time of
// verification."
//
// A source scan, because the failure is invisible from the outside: a library
// fallback looks like a kindness to somebody who denied a permission, reads
// as thoughtful in review, and shipped in the selfie screen for months on
// exactly that basis. There is no render that distinguishes a selfie taken
// now from one chosen out of a camera roll, so the only place to hold the
// line is the source.
describe('no verification screen can reach the photo library', () => {
  const SRC = path.join(__dirname, '../..');

  // Every screen where a photo is EVIDENCE rather than content. Profile
  // photos and a business gallery are content and rightly come from wherever
  // people keep their pictures.
  // The selfie capture is a COMPONENT now, not a screen: signup has to
  // present it inline, because /verification lives behind
  // `signedIn && onboarded` and an account halfway through signup is neither.
  // The rule follows the code, so the module is what gets scanned.
  const VERIFYING = [
    'features/profile/verification-capture.tsx',
    'app/verification.tsx',
    'app/onboarding/index.tsx',
    'app/business-storefront.tsx',
    'lib/live-camera.ts',
  ];

  const read = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf8');

  // Comments stripped first. All three files NAME the library picker in prose,
  // on purpose: the rule is only obeyed by people who know it exists, and the
  // comment saying "never this" is the cheapest place to learn it. What must
  // not survive is code.
  const code = (file: string) =>
    read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it.each(VERIFYING)('%s has no code path to the library picker', (file) => {
    expect(code(file)).not.toContain('launchImageLibraryAsync');
  });

  // Stronger than the line above: the screens do not talk to the picker at
  // all. Going through the one helper is what makes the rule reviewable in a
  // single file rather than re-argued at every call site.
  it.each(['features/profile/verification-capture.tsx', 'app/business-storefront.tsx'])(
    '%s captures through the shared helper and nothing else',
    (file) => {
      const text = code(file);
      expect(text).not.toContain("from 'expo-image-picker'");
      expect(text).toContain("from '@/lib/live-camera'");
    }
  );

  // And the two places that PRESENT the capture reach it through that module
  // rather than growing a second capture of their own.
  it.each(['app/verification.tsx', 'app/onboarding/index.tsx'])(
    '%s presents the shared capture rather than its own',
    (file) => {
      const text = code(file);
      expect(text).not.toContain("from 'expo-image-picker'");
      expect(text).toContain("from '@/features/profile/verification-capture'");
    }
  );
});
