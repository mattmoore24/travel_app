import fs from 'node:fs';
import path from 'node:path';

// jest.mock factories below are hoisted above this import, so the module
// under test sees the mocks.
import { signOut, signOutEverywhere } from '../api';
import { refreshPushToken } from '@/features/notifications/push';

/**
 * Sign out is local, and the device's push token goes first.
 *
 * Three findings paid for this file. signOut passed no options, and the
 * library default is GLOBAL — so the escape hatch on a flaky cold start
 * signed a traveler out on their iPad, and Cancel on the password-reset
 * screen meant sign out everywhere. Nothing ever deleted the device's
 * push_tokens row, so a signed-out phone kept showing a real sender's name
 * on the lock screen. And the token has to go BEFORE the session does,
 * because the delete-own policy checks auth.uid().
 *
 * The mocked client is legitimate here because what is being proved is call
 * ORDER and arguments in client code — that a policy works is proved by the
 * attack in supabase/tests/database/09_launch_hardening.test.sql.
 */
const order: string[] = [];

const mockSignOut = jest.fn(async (options?: { scope?: string }) => {
  order.push(`signOut:${options?.scope ?? 'none'}`);
  return { error: null };
});
const mockEq = jest.fn(async (_column: string, token: string) => {
  order.push(`tokenDeleted:${token}`);
  return { error: null };
});
const mockDelete = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn((_table: string) => ({ delete: mockDelete }));

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signOut: (options?: { scope?: string }) => mockSignOut(options),
      updateUser: jest.fn(async () => ({ error: null })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
    from: (table: string) => mockFrom(table),
    rpc: jest.fn(async () => ({ error: null })),
  },
}));

jest.mock('expo-apple-authentication', () => ({}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } },
}));
jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[jest]' })),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));

beforeEach(async () => {
  // Sign-out deletes the token it CACHED at registration — it never asks the
  // network on the way out (getExpoPushTokenAsync can hang forever on
  // unreachable APNs, and a hang is not a rejection). Seed the cache the way
  // a real launch does, then start counting.
  await refreshPushToken();
  order.length = 0;
});

describe('signOut', () => {
  it('forgets this device token, then signs out, locally by default', async () => {
    await signOut();
    // The order is the point: the delete-own policy checks auth.uid(), so a
    // delete after signOut is a delete from nobody, silently removing zero
    // rows and leaving the lock screen leaking.
    expect(order).toEqual(['tokenDeleted:ExponentPushToken[jest]', 'signOut:local']);
    expect(mockFrom).toHaveBeenCalledWith('push_tokens');
    expect(mockEq).toHaveBeenCalledWith('token', 'ExponentPushToken[jest]');
  });

  it('signOutEverywhere is the one global path, and it still takes the token', async () => {
    await signOutEverywhere();
    expect(order).toEqual(['tokenDeleted:ExponentPushToken[jest]', 'signOut:global']);
  });
});

describe('no call site outside api.ts picks its own scope', () => {
  const SRC = path.join(__dirname, '..', '..', '..');

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '__tests__' ? [] : walk(full);
      }
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });

  it('every signOut() elsewhere takes the default', () => {
    // "Which sign-outs are global" must stay answerable by searching for
    // signOutEverywhere. A scope passed at a call site is the drift this
    // package removed.
    const offenders = walk(SRC).filter((file) => {
      if (file.endsWith(path.join('features', 'auth', 'api.ts'))) {
        return false;
      }
      const code = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return /signOut\s*\(\s*\{/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
