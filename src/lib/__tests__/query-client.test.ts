import { getEverReached, queryClient, resetReachForTests, subscribeToReach } from '../query-client';

describe('query client', () => {
  it('uses a bounded stale time so travel data refreshes between sessions', () => {
    const staleTime = queryClient.getDefaultOptions().queries?.staleTime;
    expect(typeof staleTime).toBe('number');
    expect(staleTime).toBeLessThanOrEqual(60_000);
  });
});

/**
 * Driven through the real cache, the way the app drives it: a query that
 * fails, and a count of how many times its function ran. The thing that can
 * break is the wiring between "this error never left the phone" and "do not
 * ask again", and reading the option back would pass with that wiring cut.
 *
 * `retryDelay: 0` keeps React Query's 1s/2s backoff out of the run; the
 * retry POLICY is the client's default, which fetchQuery keeps when it is
 * set (it only falls back to no retries when nothing is configured).
 */
let key = 0;
const failing = (error: () => unknown) => jest.fn(() => Promise.reject(error()));

const run = async (queryFn: () => Promise<unknown>) =>
  queryClient
    .fetchQuery({ queryKey: ['retry-policy', key++], queryFn, retryDelay: 0, gcTime: 0 })
    .catch(() => {});

const offline = () => new Error('Network request failed');
const serverFailure = () => ({ status: 500, message: 'boom' });

describe('the retry policy', () => {
  it('does not retry a request that never left the phone', async () => {
    const queryFn = failing(offline);
    await run(queryFn);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('does not retry an aborted request either, which is what the PostgREST timeout hands back', async () => {
    const queryFn = failing(() => ({
      status: 0,
      message: 'AbortError: The user aborted a request.',
    }));
    await run(queryFn);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  // The 503 while PostgREST reloads its schema cache after a deploy: the
  // failure postgrest-js's own (now disabled) retry existed for.
  it('still tries a failure the server sent twice more', async () => {
    const queryFn = failing(serverFailure);
    await run(queryFn);
    expect(queryFn).toHaveBeenCalledTimes(3);
  });
});

describe('everReached', () => {
  beforeEach(() => {
    resetReachForTests();
  });

  it('is false on a cold start', () => {
    expect(getEverReached()).toBe(false);
  });

  it('stays false after a failure that never left the phone', async () => {
    await run(failing(offline));
    expect(getEverReached()).toBe(false);
  });

  it('flips on the first success', async () => {
    await run(() => Promise.resolve(1));
    expect(getEverReached()).toBe(true);
  });

  // A 403 came BACK from the server. It is as much proof of a connection as
  // a success, and the pill has always read it that way.
  it('flips on a failure the server sent', async () => {
    await run(failing(() => ({ status: 403, message: 'row-level security' })));
    expect(getEverReached()).toBe(true);
  });

  it('does not flip on a failure it cannot classify', async () => {
    await run(failing(() => new Error('boom')));
    expect(getEverReached()).toBe(false);
  });

  // Sticky: the cold start is once per launch. A dropped connection later in
  // the day is a warm-app failure and belongs to the pill, not the card.
  it('stays true after a later offline failure', async () => {
    await run(() => Promise.resolve(1));
    await run(failing(offline));
    expect(getEverReached()).toBe(true);
  });

  it('tells its subscribers once, on the flip, and not again', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToReach(listener);
    await run(failing(offline));
    expect(listener).not.toHaveBeenCalled();
    await run(() => Promise.resolve(1));
    expect(listener).toHaveBeenCalledTimes(1);
    await run(() => Promise.resolve(2));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
