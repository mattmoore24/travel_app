import { renderHook } from '@testing-library/react-native';

import { useRefetchOnRefocus } from '@/hooks/use-refetch-on-refocus';

describe('useRefetchOnRefocus', () => {
  const make = (isStale: boolean) => ({ isStale, refetch: jest.fn() });

  it('refetches once on the blur to focus flip when stale', () => {
    const query = make(true);
    const { rerender } = renderHook(
      ({ focused }: { focused: boolean }) => useRefetchOnRefocus(focused, query),
      {
        initialProps: { focused: false },
      }
    );
    expect(query.refetch).not.toHaveBeenCalled();
    rerender({ focused: true });
    expect(query.refetch).toHaveBeenCalledTimes(1);
    // Staying focused never fires again: the interval owns steady state.
    rerender({ focused: true });
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a quick bounce inside staleTime', () => {
    const query = make(false);
    const { rerender } = renderHook(
      ({ focused }: { focused: boolean }) => useRefetchOnRefocus(focused, query),
      {
        initialProps: { focused: false },
      }
    );
    rerender({ focused: true });
    expect(query.refetch).not.toHaveBeenCalled();
  });

  it('does nothing while already focused from the start', () => {
    const query = make(true);
    renderHook(() => useRefetchOnRefocus(true, query));
    expect(query.refetch).not.toHaveBeenCalled();
  });
});
