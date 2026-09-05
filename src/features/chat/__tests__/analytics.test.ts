import { captureMessageSent } from '@/features/chat/analytics';

/**
 * message_sent has one shape, whatever sent it. The text path used to omit
 * `kind`, the photo path used to omit `chat_id`, so a breakdown on kind read
 * 'photo' versus undefined and per-conversation analysis dropped every
 * photo. Both call shapes must produce all three properties.
 */

const mockCapture = jest.fn();
jest.mock('@/lib/analytics', () => ({
  analytics: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

beforeEach(() => mockCapture.mockClear());

it.each([
  ['text', 'direct', { chat_id: 'c1', kind: 'text', surface: 'direct' }],
  ['text', 'room', { chat_id: 'c1', kind: 'text', surface: 'room' }],
  ['photo', 'direct', { chat_id: 'c1', kind: 'photo', surface: 'direct' }],
  ['photo', 'room', { chat_id: 'c1', kind: 'photo', surface: 'room' }],
] as const)(
  'a %s message in a %s conversation carries all three properties',
  (kind, thread, expected) => {
    captureMessageSent('c1', kind, thread);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith('message_sent', expected);
  }
);
