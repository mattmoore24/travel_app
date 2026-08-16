import { isSupabaseConfigured, supabase } from '../supabase';

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
