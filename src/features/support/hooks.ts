import { useMutation } from '@tanstack/react-query';

import { sendSupportMessage } from '@/features/support/api';
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
