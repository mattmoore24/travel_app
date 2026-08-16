import { SecureSessionStore } from '../secure-session-store';

const mockSecure = new Map<string, string>();
const mockAsync = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockSecure.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    mockSecure.set(k, v);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    mockSecure.delete(k);
    return Promise.resolve();
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockAsync.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      mockAsync.set(k, v);
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      mockAsync.delete(k);
      return Promise.resolve();
    }),
  },
}));

describe('SecureSessionStore (keychain key + AsyncStorage ciphertext)', () => {
  beforeEach(() => {
    mockSecure.clear();
    mockAsync.clear();
  });

  it('round-trips a session larger than the 2KB SecureStore limit', async () => {
    const store = new SecureSessionStore();
    const bigSession = JSON.stringify({ access_token: 'x'.repeat(4096), user: { id: 'u1' } });
    await store.setItem('sb-session', bigSession);
    await expect(store.getItem('sb-session')).resolves.toBe(bigSession);
  });

  it('stores only ciphertext outside the keychain', async () => {
    const store = new SecureSessionStore();
    const secret = 'super-secret-refresh-token';
    await store.setItem('sb-session', secret);
    const stored = mockAsync.get('sb-session')!;
    expect(stored).not.toContain(secret);
    expect(stored).toMatch(/^[0-9a-f]+$/);
  });

  it('returns null (not garbage) when key material is missing', async () => {
    const store = new SecureSessionStore();
    await store.setItem('sb-session', 'value');
    mockSecure.clear(); // simulate keychain wiped (e.g. app reinstall)
    await expect(store.getItem('sb-session')).resolves.toBeNull();
  });

  it('removes both halves on removeItem', async () => {
    const store = new SecureSessionStore();
    await store.setItem('sb-session', 'value');
    await store.removeItem('sb-session');
    expect(mockAsync.size).toBe(0);
    expect(mockSecure.size).toBe(0);
    await expect(store.getItem('sb-session')).resolves.toBeNull();
  });
});
