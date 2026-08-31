import { readAppleCredential } from '@/features/auth/apple-revoke';

// jest hoists every jest.mock() below above this import, which is why the
// import may sit at the top: the mocks are in place before the module loads.

/**
 * Only REVOKED means revoked.
 *
 * NOT_FOUND is a distinct state and Apple returns it whenever the device has
 * no relationship with the credential at all, which is what a phone signed
 * out of iCloud, or signed into a different Apple ID, answers. Reading it as
 * a revocation ended the session of a traveller who did nothing but sign out
 * of iCloud abroad, and told her Apple had cut her off. TRANSFERRED is the
 * same class of answer. Inconclusive is 'unknown', and 'unknown' never ends
 * a session.
 */
// The four states, with the values the installed
// expo-apple-authentication types declare (REVOKED = 0, so it is falsy and
// worth stating rather than inferring). Declared INSIDE the factory: jest
// hoists the factory above this file's const initializers, so a reference to
// an outer const would capture undefined and every comparison would miss.
const mockState = { REVOKED: 0, AUTHORIZED: 1, NOT_FOUND: 2, TRANSFERRED: 3 };

const mockGetCredentialState = jest.fn();

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationCredentialState: { REVOKED: 0, AUTHORIZED: 1, NOT_FOUND: 2, TRANSFERRED: 3 },
  getCredentialStateAsync: (...args: unknown[]) => mockGetCredentialState(...args),
  addRevokeListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock('@/lib/apple-user', () => ({
  readAppleUser: jest.fn(async () => 'apple-user-id'),
}));

jest.mock('@/features/auth/api', () => ({ endRevokedSession: jest.fn(async () => {}) }));
jest.mock('@/features/auth/store', () => ({ useAuthStore: jest.fn() }));

describe('readAppleCredential', () => {
  it('reads REVOKED as revoked, which is the one state that ends a session', async () => {
    mockGetCredentialState.mockResolvedValueOnce(mockState.REVOKED);
    await expect(readAppleCredential()).resolves.toBe('revoked');
  });

  it('reads AUTHORIZED as active', async () => {
    mockGetCredentialState.mockResolvedValueOnce(mockState.AUTHORIZED);
    await expect(readAppleCredential()).resolves.toBe('active');
  });

  it('does NOT read NOT_FOUND as revoked: signing out of iCloud is not a revocation', async () => {
    mockGetCredentialState.mockResolvedValueOnce(mockState.NOT_FOUND);
    await expect(readAppleCredential()).resolves.toBe('unknown');
  });

  it('does not read TRANSFERRED as revoked either', async () => {
    mockGetCredentialState.mockResolvedValueOnce(mockState.TRANSFERRED);
    await expect(readAppleCredential()).resolves.toBe('unknown');
  });

  it('is unknown, never revoked, when Apple cannot be asked at all', async () => {
    mockGetCredentialState.mockRejectedValueOnce(new Error('simulator'));
    await expect(readAppleCredential()).resolves.toBe('unknown');
  });
});
