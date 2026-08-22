import {
  carryFailed,
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

describe('carryFailed', () => {
  const sending = optimisticMessage({ chatId: 'c', senderId: 's', body: 'see you at 8', at: AT });
  const failed = { ...sending, local: 'failed' as const };

  it('keeps a failed send across a refetch that knows nothing about it', () => {
    const refetched = [real('server-1'), real('server-2')];
    expect(carryFailed([failed, real('server-1')], refetched)).toEqual([failed, ...refetched]);
  });

  it('puts it at the near end, where the person just tried to send it', () => {
    expect(carryFailed([failed], [real('older')])[0]).toBe(failed);
  });

  it('drops a send still in flight, because settling puts the real row back', () => {
    expect(carryFailed([sending], [real('server-1')])).toEqual([real('server-1')]);
  });

  it('returns the fetched array untouched when nothing failed', () => {
    const refetched = [real('server-1')];
    expect(carryFailed([real('server-1')], refetched)).toBe(refetched);
  });

  it('survives a first fetch with no cache at all', () => {
    const refetched = [real('server-1')];
    expect(carryFailed(undefined, refetched)).toBe(refetched);
  });
});
