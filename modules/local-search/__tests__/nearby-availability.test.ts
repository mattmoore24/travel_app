import type { LocalSearchResult } from '../index';

/**
 * The OTA-to-old-binary case, which is the one thing a simulator run cannot
 * show: this app ships JavaScript over the air to binaries built before
 * nearbyAsync existed. On those, `requireOptionalNativeModule` returns the
 * MODULE — it shipped with searchAsync — so `venueSearchAvailable` is true
 * while the new METHOD is undefined. A caller that checked the module and
 * not the method would crash the founder's current TestFlight build in
 * place mode the moment an OTA update landed. nearbyPlaces must resolve []
 * there, never throw.
 */

const load = (native: unknown): typeof import('../index') => {
  let mod: typeof import('../index') | undefined;
  jest.isolateModules(() => {
    // Spread the real module: other things in the environment (expo's own
    // global installs) reach for requireNativeModule and friends, and a
    // stub that replaced the whole surface took the test runner down with
    // it. Only the optional lookup is bent.
    jest.doMock('expo-modules-core', () => ({
      ...jest.requireActual('expo-modules-core'),
      requireOptionalNativeModule: () => native,
    }));
    mod = require('../index');
  });
  jest.dontMock('expo-modules-core');
  return mod!;
};

const venue: LocalSearchResult = {
  name: 'On Lok Yun',
  address: '72 Charoen Krung Rd',
  locality: 'Phra Nakhon',
  latitude: 13.746,
  longitude: 100.5,
  category: 'MKPOICategoryCafe',
};

describe('nearbyPlaces on binaries of three ages', () => {
  it('resolves [] on a binary with no module at all', async () => {
    const mod = load(null);
    expect(mod.venueSearchAvailable).toBe(false);
    expect(mod.nearbySearchAvailable).toBe(false);
    await expect(mod.nearbyPlaces({ latitude: 1, longitude: 2 })).resolves.toEqual([]);
  });

  it('resolves [] on a binary whose module predates the method', async () => {
    // The founder's current TestFlight build: the module is there, the
    // method is not. This is why nearbySearchAvailable checks the METHOD.
    const searchAsync = jest.fn();
    const mod = load({ searchAsync });
    expect(mod.venueSearchAvailable).toBe(true);
    expect(mod.nearbySearchAvailable).toBe(false);
    await expect(mod.nearbyPlaces({ latitude: 1, longitude: 2 })).resolves.toEqual([]);
    expect(searchAsync).not.toHaveBeenCalled();
  });

  it('forwards the call once the method exists', async () => {
    const nearbyAsync = jest.fn().mockResolvedValue([venue]);
    const mod = load({ searchAsync: jest.fn(), nearbyAsync });
    expect(mod.nearbySearchAvailable).toBe(true);
    await expect(mod.nearbyPlaces({ latitude: 13.75, longitude: 100.49 })).resolves.toEqual([
      venue,
    ]);
    // The defaults are part of the contract: about a block, a short list.
    expect(nearbyAsync).toHaveBeenCalledWith(13.75, 100.49, 120, 6);
  });
});
