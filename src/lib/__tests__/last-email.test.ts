import { forgetLastEmail, readLastEmail, rememberLastEmail } from '../last-email';

const mockKeychain = new Map<string, string>();
const mockState = { failing: false };

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => {
    if (mockState.failing) {
      throw new Error('keychain unavailable');
    }
    return mockKeychain.get(k) ?? null;
  }),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (mockState.failing) {
      throw new Error('keychain unavailable');
    }
    mockKeychain.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    if (mockState.failing) {
      throw new Error('keychain unavailable');
    }
    mockKeychain.delete(k);
  }),
}));

beforeEach(() => {
  mockKeychain.clear();
  mockState.failing = false;
});

describe('the address this device last signed in with', () => {
  it('round-trips, trimmed', async () => {
    await rememberLastEmail('  ana@example.com  ');
    await expect(readLastEmail()).resolves.toBe('ana@example.com');
  });

  it('is null before anybody has signed in', async () => {
    await expect(readLastEmail()).resolves.toBeNull();
  });

  it('refuses to remember an empty address', async () => {
    await rememberLastEmail('   ');
    await expect(readLastEmail()).resolves.toBeNull();
  });

  it('is cleared explicitly, which is the whole D39 bargain', async () => {
    // It survives an uninstall on purpose, so Delete account and "Sign out on
    // all devices" are the only two things that can take it away.
    await rememberLastEmail('ana@example.com');
    await forgetLastEmail();
    await expect(readLastEmail()).resolves.toBeNull();
  });

  it('swallows a keychain that will not answer, in all three directions', async () => {
    mockState.failing = true;
    // A keychain failure must never be able to stop somebody signing in, and
    // a failed clear must never break the delete it is part of.
    await expect(rememberLastEmail('ana@example.com')).resolves.toBeUndefined();
    await expect(readLastEmail()).resolves.toBeNull();
    await expect(forgetLastEmail()).resolves.toBeUndefined();
  });
});
