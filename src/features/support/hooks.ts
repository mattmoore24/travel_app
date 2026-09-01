import { useMutation, useQuery } from '@tanstack/react-query';

import { fetchMyReports, fetchMySupportMessages, sendSupportMessage } from '@/features/support/api';
import { useOwnUserId } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';

export function useSendSupportMessage() {
  return useMutation({
    mutationFn: (input: { replyTo: string; body: string; category?: string | null }) =>
      sendSupportMessage(input),
    onSuccess: (_data, input) => {
      // The category and nothing else. Never the body, never the address:
      // what somebody wrote to support is not analytics.
      analytics.capture('support_message_sent', { category: input.category ?? 'unset' });
    },
  });
}

/**
 * What became of the reports this account filed.
 *
 * Off for a guest, and that is the answer rather than an oversight: a report
 * is filed under an account, so there is nothing to return. Keyed on the user
 * id so signing out and back in as somebody else cannot serve the previous
 * account's history out of the cache.
 */
export function useMyReports() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['my-reports', userId],
    queryFn: fetchMyReports,
    enabled: userId != null,
  });
}

/** The same question about messages to support. Same gate, same reason. */
export function useMySupportMessages() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['my-support-messages', userId],
    queryFn: fetchMySupportMessages,
    enabled: userId != null,
  });
}
