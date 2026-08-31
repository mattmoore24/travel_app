import { analytics } from '@/lib/analytics';

/**
 * One message_sent, one shape, from every path that sends one.
 *
 * The text path used to send `{chat_id}` and never `kind`; the photo path
 * sent `{kind:'photo'}` and never `chat_id`. Any breakdown on kind came out
 * as 'photo' versus undefined, and any per-conversation analysis silently
 * dropped every photo. And neither said whether the conversation is a direct
 * chat or a joinable-pin room — which is the question the map-led thesis
 * rests on: do pins produce conversation, or just taps.
 */
export function captureMessageSent(
  chatId: string,
  kind: 'text' | 'photo',
  thread: 'direct' | 'room'
) {
  analytics.capture('message_sent', {
    chat_id: chatId,
    kind,
    surface: thread === 'room' ? 'room' : 'direct',
  });
}
