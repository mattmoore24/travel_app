import { useMutation } from '@tanstack/react-query';

import { sendSupportMessage } from '@/features/support/api';
import { analytics } from '@/lib/analytics';

export function useSendSupportMessage() {
  return useMutation({
    mutationFn: (input: { replyTo: string; body: string }) => sendSupportMessage(input),
    onSuccess: () => {
      // No content, no address: only that somebody reached out.
      analytics.capture('support_message_sent');
    },
  });
}
