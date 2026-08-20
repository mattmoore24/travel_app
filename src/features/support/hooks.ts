import { useMutation } from '@tanstack/react-query';

import { useOwnUserId } from '@/features/profile/hooks';
import { sendSupportMessage } from '@/features/support/api';
import { analytics } from '@/lib/analytics';

export function useSendSupportMessage() {
  const userId = useOwnUserId();
  return useMutation({
    mutationFn: (input: { replyTo: string; body: string }) =>
      sendSupportMessage({ userId, ...input }),
    onSuccess: () => {
      // No content, no address: only that somebody reached out.
      analytics.capture('support_message_sent');
    },
  });
}
