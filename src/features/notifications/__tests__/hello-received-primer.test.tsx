import { renderHook } from '@testing-library/react-native';

import { useIncomingRequests } from '@/features/matching/hooks';
import { useHelloReceivedPrimer } from '@/features/notifications/use-hello-received-primer';

/**
 * The inbound ask, and the reason it is an effect rather than an onSuccess.
 *
 * The inbox query refetches on every focus and returns the same unanswered
 * hello each time. Hung off the query's success it would put the same
 * question up again on every visit, which is the nagging the single-ask rule
 * was trying to prevent in the first place.
 */

const mockAsk = jest.fn();
jest.mock('@/features/notifications/primer-store', () => ({
  usePushPrimer: { getState: () => ({ ask: mockAsk }) },
}));
jest.mock('@/features/matching/hooks', () => ({ useIncomingRequests: jest.fn() }));

const inbox = useIncomingRequests as unknown as jest.Mock;

const rows = (count: number) => ({
  data: Array.from({ length: count }, (_, i) => ({ id: `r${i}` })),
});

describe('the ask at the first hello somebody sends you', () => {
  it('says nothing while the inbox is empty', () => {
    inbox.mockReturnValue(rows(0));
    renderHook(() => useHelloReceivedPrimer());
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('says nothing before the inbox has loaded', () => {
    inbox.mockReturnValue({ data: undefined });
    renderHook(() => useHelloReceivedPrimer());
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('asks once when somebody has written to you', () => {
    inbox.mockReturnValue(rows(1));
    renderHook(() => useHelloReceivedPrimer());
    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(mockAsk).toHaveBeenCalledWith('hello-received');
  });

  it('does not ask again when the refetch returns the same hello', () => {
    inbox.mockReturnValue(rows(1));
    const hook = renderHook(() => useHelloReceivedPrimer());
    // A background refetch hands back a NEW array with the same content,
    // which is what makes the effect re-run at all.
    inbox.mockReturnValue(rows(1));
    hook.rerender(undefined);
    inbox.mockReturnValue(rows(2));
    hook.rerender(undefined);
    expect(mockAsk).toHaveBeenCalledTimes(1);
  });
});
