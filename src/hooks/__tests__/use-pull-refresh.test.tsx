import { act, renderHook } from '@testing-library/react-native';

import { usePullRefresh } from '@/hooks/use-pull-refresh';

/**
 * A RefreshControl spins for a pull and for nothing else. Travelers and Chat
 * fed theirs `isFetching`, which is true for the refocus refetch on every tab
 * return, so the list dipped and spun for work nobody asked for.
 */

const deferred = () => {
  let resolve: (value?: unknown) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('usePullRefresh', () => {
  it('is not refreshing until somebody pulls', () => {
    const { result } = renderHook(() => usePullRefresh(jest.fn()));
    expect(result.current.refreshing).toBe(false);
  });

  it('spins from the pull until the refetch settles', async () => {
    const fetch = deferred();
    const refetch = jest.fn(() => fetch.promise);
    const { result } = renderHook(() => usePullRefresh(refetch));

    act(() => {
      result.current.onRefresh();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      fetch.resolve();
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('takes a refetch that returns nothing', async () => {
    const { result } = renderHook(() => usePullRefresh(() => {}));
    await act(async () => {
      result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('stops spinning when the refetch fails, and leaves the error to the query', async () => {
    const fetch = deferred();
    const { result } = renderHook(() => usePullRefresh(() => fetch.promise));
    act(() => {
      result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(true);
    await act(async () => {
      fetch.reject(new Error('offline'));
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('keeps spinning until the last of two overlapping pulls settles', async () => {
    const first = deferred();
    const second = deferred();
    const refetch = jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => usePullRefresh(refetch));
    act(() => {
      result.current.onRefresh();
      result.current.onRefresh();
    });
    await act(async () => {
      first.resolve();
    });
    expect(result.current.refreshing).toBe(true);
    await act(async () => {
      second.resolve();
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('settles quietly on a list that has gone', async () => {
    // Nothing to assert about a warning React no longer prints; what can be
    // pinned is that a fetch resolving after the unmount neither throws nor
    // rejects the pull.
    const fetch = deferred();
    const { result, unmount } = renderHook(() => usePullRefresh(() => fetch.promise));
    let pull: Promise<void> | undefined;
    act(() => {
      pull = result.current.onRefresh() as unknown as Promise<void>;
    });
    unmount();
    await act(async () => {
      fetch.resolve();
    });
    await expect(pull).resolves.toBeUndefined();
  });
});
