import { queryClient } from '../query-client';

describe('query client', () => {
  it('uses a bounded stale time so travel data refreshes between sessions', () => {
    const staleTime = queryClient.getDefaultOptions().queries?.staleTime;
    expect(typeof staleTime).toBe('number');
    expect(staleTime).toBeLessThanOrEqual(60_000);
  });
});
