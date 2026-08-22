import {
  dropOptimistic,
  failOptimistic,
  isLocalId,
  localId,
  optimisticMessage,
  optimisticRoomMessage,
  settleOptimistic,
  withOptimistic,
  type ThreadMessage,
} from '@/features/chat/outgoing';

const AT = new Date('2026-08-22T10:00:00.000Z');

function real(id: string, body = 'hi'): ThreadMessage {
  return {
    id,
    chat_id: 'c',
    sender_id: 's',
    body,
    image_path: null,
    created_at: AT.toISOString(),
  };
}

describe('local ids', () => {
  it('cannot be mistaken for a server id', () => {
    expect(isLocalId(localId(AT))).toBe(true);
    expect(isLocalId('4c1f0e8a-0000-4000-8000-000000000000')).toBe(false);
  });
});

describe('optimisticMessage', () => {
  it('is a real bubble the moment it is made, marked as not yet sent', () => {
    const message = optimisticMessage({
      chatId: 'c',
      senderId: 's',
      body: 'landing tuesday',
      at: AT,
    });
    expect(message.body).toBe('landing tuesday');
    expect(message.local).toBe('sending');
    expect(isLocalId(message.id)).toBe(true);
  });

  it('has a room-shaped twin, because rooms read a different row', () => {
    const message = optimisticRoomMessage({ senderId: 's', body: 'tapas?', at: AT });
    expect(message.body).toBe('tapas?');
    expect(message.local).toBe('sending');
    expect(message.removed).toBe(false);
  });
});

describe('settleOptimistic', () => {
  it('swaps the placeholder for the row the server stored', () => {
    const pending = optimisticMessage({ chatId: 'c', senderId: 's', body: 'hi', at: AT });
    const settled = settleOptimistic(
      withOptimistic([real('older')], pending),
      pending.id,
      real('new')
    );
    expect(settled.map((m) => m.id)).toEqual(['new', 'older']);
  });

  it('does not show the message twice when realtime beat the response', () => {
    const pending = optimisticMessage({ chatId: 'c', senderId: 's', body: 'hi', at: AT });
    const raced = [real('new'), ...withOptimistic([real('older')], pending)];
    const settled = settleOptimistic(raced, pending.id, real('new'));
    expect(settled.filter((m) => m.id === 'new')).toHaveLength(1);
    expect(settled.some((m) => m.id === pending.id)).toBe(false);
  });
});

describe('failOptimistic', () => {
  it('keeps the sentence, so there is something to retry', () => {
    const pending = optimisticMessage({ chatId: 'c', senderId: 's', body: 'see you at 8', at: AT });
    const failed = failOptimistic(withOptimistic([], pending), pending.id);
    expect(failed).toHaveLength(1);
    expect(failed[0].body).toBe('see you at 8');
    expect(failed[0].local).toBe('failed');
  });

  it('leaves every other message alone', () => {
    const pending = optimisticMessage({ chatId: 'c', senderId: 's', body: 'hi', at: AT });
    const failed = failOptimistic(withOptimistic([real('older')], pending), pending.id);
    expect(failed.find((m) => m.id === 'older')?.local).toBeUndefined();
  });
});

describe('dropOptimistic', () => {
  it('removes just that one, for a retry that replaces it', () => {
    const pending = optimisticMessage({ chatId: 'c', senderId: 's', body: 'hi', at: AT });
    expect(dropOptimistic(withOptimistic([real('older')], pending), pending.id)).toHaveLength(1);
  });
});
