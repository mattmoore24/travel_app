import { isOffline } from '@/lib/failure-message';
import { source } from '@/lib/__tests__/source';

import {
  REQUEST_TIMEOUT_MS,
  ServerUnreachable,
  isSupabaseConfigured,
  probeServer,
  supabase,
} from '../supabase';

describe('supabase client wiring', () => {
  it('module loads without env vars (fresh clone must run before .env exists)', () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe('function');
  });

  it('reports unconfigured state instead of crashing when env is missing', () => {
    // In CI there is no .env, so this documents the expected fresh-clone state.
    expect(typeof isSupabaseConfigured).toBe('boolean');
    if (!process.env.EXPO_PUBLIC_SUPABASE_URL) {
      expect(isSupabaseConfigured).toBe(false);
    }
  });
});

/**
 * Two options that live in node_modules and were costing the offline cold
 * start most of its blank screen: postgrest-js retries every GET three
 * times on its own (1s, 2s, 4s) before React Query sees a failure, and with
 * no timeout a request on wifi with no upstream waits on iOS's 60-second
 * default. Pinned by source, because the client object does not expose them
 * back.
 */
describe('the PostgREST budget', () => {
  const code = source('src/lib/supabase.ts');

  it('turns postgrest-js retries off, so React Query is the one retry layer', () => {
    expect(code).toMatch(/db:\s*\{\s*retry:\s*false,\s*timeout:\s*REQUEST_TIMEOUT_MS\s*\}/);
  });

  it('bounds every request, generously enough for the slowest real query', () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

/**
 * The boot probe: one HEAD from the first frame, through React Query, so the
 * connection store has evidence while auth-js is still deciding.
 */
describe('probeServer', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('resolves on ANY HTTP response, because an answer of any kind proves the server was reached', async () => {
    globalThis.fetch = jest.fn(async () => ({ status: 401 }) as Response);
    await expect(probeServer()).resolves.toBe(401);
    const [url, init] = jest.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/rest\/v1\/$/);
    expect(init.method).toBe('HEAD');
  });

  it('throws something the app already reads as offline when nothing comes back', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const failure = await probeServer().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ServerUnreachable);
    expect(isOffline(failure)).toBe(true);
  });
});
