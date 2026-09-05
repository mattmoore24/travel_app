import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { sendMessageRequest } from '@/features/matching/api';
import { useSendRequest } from '@/features/matching/hooks';
import { analytics } from '@/lib/analytics';

/**
 * The push-permission ask fires on a QUEUED hello, not only a delivered one.
 *
 * With require_llm_moderation on, every hello leaves as queued rather than
 * delivered — the recipient simply gets it a little later — so a gate on
 * `delivered` alone silently switched the notification ask off on the one
 * flow it was built for. This pins the gate to `delivered || queued`, and
 * pins `queued` into the request_sent capture so the §6 funnel can see the
 * moderated path at all.
 */

jest.mock('@/features/matching/api');
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));
jest.mock('@/features/profile/hooks', () => ({ useOwnUserId: () => 'me' }));
jest.mock('@/features/business/hooks', () => ({ useIsBusiness: () => false }));

const mockAsk = jest.fn();
jest.mock('@/features/notifications/primer-store', () => ({
  usePushPrimer: { getState: () => ({ ask: mockAsk }) },
}));

const send = sendMessageRequest as jest.MockedFunction<typeof sendMessageRequest>;
const capture = analytics.capture as jest.Mock;

const result = (overrides: Partial<Awaited<ReturnType<typeof sendMessageRequest>>>) => ({
  request_id: 'r1',
  delivered: false,
  queued: false,
  blocked: false,
  capped: false,
  allowed: 8,
  used: 1,
  category: null,
  ...overrides,
});

const sendHello = async () => {
  // gcTime 0 so the client holds no timers past the test; the leak otherwise
  // keeps the jest worker alive after the suite is done.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useSendRequest(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync({
      recipientId: 'them',
      recipientName: 'Ana',
      origin: 'travelers',
      source: 'trip_match',
      firstMessage: 'Both in Bangkok next week, up for a market run?',
      profileElement: 'trip',
      everFlagged: false,
    });
  });
  // Let the mutation's own notify settle inside act, then drop everything.
  await act(async () => {});
  hook.unmount();
  client.clear();
};

describe('the ask after a hello', () => {
  it('runs on a queued result, so moderation cannot switch it off', async () => {
    send.mockResolvedValue(result({ queued: true }));
    await sendHello();
    expect(mockAsk).toHaveBeenCalledWith('hello-sent');
  });

  it('still runs on a delivered result', async () => {
    send.mockResolvedValue(result({ delivered: true }));
    await sendHello();
    expect(mockAsk).toHaveBeenCalledWith('hello-sent');
  });

  it('does not run on a blocked result', async () => {
    send.mockResolvedValue(result({ blocked: true }));
    await sendHello();
    expect(mockAsk).not.toHaveBeenCalled();
  });
});

describe('the request_sent capture', () => {
  it('carries the queued flag, so the funnel can see the moderated path', async () => {
    send.mockResolvedValue(result({ queued: true }));
    await sendHello();
    expect(capture).toHaveBeenCalledWith(
      'request_sent',
      expect.objectContaining({ queued: true, delivered: false, blocked: false })
    );
  });
});
