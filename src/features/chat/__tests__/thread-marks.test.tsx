import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MessageThread } from '@/features/chat/message-thread';
import type { Quote } from '@/features/chat/reply';
import type { MessageRow } from '@/lib/database.types';

/**
 * The marks on a bubble that say what it is: the quoted strip above a reply,
 * where Reply sits on the long-press card, and the New line where reading
 * stopped.
 *
 * These pin the wiring, not the interaction: fireEvent calls the handler
 * directly and never enters the responder system, so a long press that a real
 * finger cannot land still passes here (see message-thread.test.tsx). The
 * simulator run is what proves the press.
 */

jest.mock('@/features/chat/hooks', () => ({
  useChatPhotoUrl: () => ({ data: null }),
}));

jest.mock('@/features/profile/hooks', () => ({
  usePhotoUrl: () => ({ data: null }),
}));

const message = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: 'm1',
  chat_id: 'c1',
  sender_id: 'them',
  body: 'Rooftop at 9?',
  image_path: null,
  created_at: new Date('2026-08-31T11:07:00Z').toISOString(),
  ...over,
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderThread(props: Partial<Parameters<typeof MessageThread>[0]> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MessageThread
        messages={[message()]}
        ownUserId="me"
        reactions={[]}
        onToggleReaction={jest.fn()}
        {...props}
      />
    </SafeAreaProvider>
  );
}

const quote = (over: Partial<Quote> = {}): Quote => ({
  name: 'Ana',
  body: 'Rooftop at 9?',
  state: 'known',
  ...over,
});

describe('the quoted strip', () => {
  it('is absent from an ordinary message', () => {
    renderThread({ quoteFor: () => null });
    expect(screen.queryByText('Ana')).toBeNull();
  });

  it('names who is being answered, and shows their line', () => {
    renderThread({
      messages: [message({ id: 'm2', body: "I'm in", reply_to_message_id: 'm1' })],
      quoteFor: () => quote(),
    });
    expect(screen.getByText('Ana')).toBeTruthy();
    // The exact words a person reads, not a pattern that would pass on any
    // string at all.
    expect(screen.getByText('Rooftop at 9?')).toBeTruthy();
  });

  it('says the parent is gone rather than drawing an empty strip', () => {
    renderThread({
      messages: [message({ id: 'm2', body: "I'm in", reply_to_message_id: 'm1' })],
      quoteFor: () => quote({ body: null }),
    });
    expect(screen.getByText('Message no longer here')).toBeTruthy();
  });
});

describe('the Reply action', () => {
  it('leads the card, ahead of Pin', () => {
    renderThread({ onReply: jest.fn(), onPin: jest.fn() });
    fireEvent(screen.getByLabelText('Rooftop at 9?'), 'longPress');
    const labels = screen
      .getAllByRole('button')
      .map((node) => node.props.accessibilityLabel as string);
    expect(labels).toContain('Reply');
    expect(labels.indexOf('Reply')).toBeLessThan(labels.indexOf('Pin to the top'));
  });

  it('hands the caller the message id and closes the menu', () => {
    const onReply = jest.fn();
    renderThread({ onReply });
    fireEvent(screen.getByLabelText('Rooftop at 9?'), 'longPress');
    fireEvent.press(screen.getByLabelText('Reply'));
    expect(onReply).toHaveBeenCalledWith('m1');
    // The scrim is the menu: it only exists while the menu is open.
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
  });

  it('is not offered at all where the caller cannot take a reply', () => {
    renderThread({ onPin: jest.fn() });
    fireEvent(screen.getByLabelText('Rooftop at 9?'), 'longPress');
    expect(screen.queryByLabelText('Reply')).toBeNull();
  });
});

describe('the New line', () => {
  it('is absent from a thread with nothing waiting', () => {
    renderThread();
    expect(screen.queryByText('New')).toBeNull();
  });

  it('is drawn once, above the oldest message the reader has not seen', () => {
    renderThread({
      messages: [
        message({ id: 'm2', body: 'and bring cash' }),
        message({ id: 'm1', body: 'Rooftop at 9?' }),
      ],
      unreadFrom: 'm1',
    });
    // The exact word a person reads, and exactly one of it.
    expect(screen.getAllByText('New')).toHaveLength(1);
  });
});
