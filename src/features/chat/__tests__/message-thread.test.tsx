import { fireEvent, render, screen } from '@testing-library/react-native';

import { MessageThread } from '@/features/chat/message-thread';
import type { MessageRow } from '@/lib/database.types';

// The reaction menu is the founder's headline complaint and the one
// interaction the simulator suite cannot prove: Maestro's long press does not
// drive React Native's Pressable on iOS, so a run can only ever show that the
// menu did not appear, never that it does. This asks the component directly.

jest.mock('@/features/chat/hooks', () => ({
  useChatPhotoUrl: () => ({ data: null }),
}));

const message = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: 'm1',
  chat_id: 'c1',
  sender_id: 'them',
  body: 'First one in',
  image_path: null,
  created_at: new Date('2026-08-21T11:07:00Z').toISOString(),
  ...over,
});

function renderThread(props: Partial<Parameters<typeof MessageThread>[0]> = {}) {
  return render(
    <MessageThread
      messages={[message()]}
      ownUserId="me"
      reactions={[]}
      onToggleReaction={jest.fn()}
      {...props}
    />
  );
}

describe('the reaction menu', () => {
  it('opens on a long press, anchored to the message', () => {
    renderThread();
    fireEvent(screen.getByLabelText('First one in'), 'longPress');
    // The scrim is the menu: it only exists while the menu is open.
    expect(screen.getByLabelText('Dismiss')).toBeTruthy();
    expect(screen.getByLabelText('❤️')).toBeTruthy();
  });

  it('reports the emoji the person picked', () => {
    const onToggleReaction = jest.fn();
    renderThread({ onToggleReaction });
    fireEvent(screen.getByLabelText('First one in'), 'longPress');
    fireEvent.press(screen.getByLabelText('❤️'));
    expect(onToggleReaction).toHaveBeenCalledWith('m1', '❤️', true);
  });

  it('takes a reaction back when the same emoji is picked again', () => {
    const onToggleReaction = jest.fn();
    renderThread({
      onToggleReaction,
      reactions: [{ message_id: 'm1', emoji: '❤️', count: 1, reacted_by_me: true }],
    });
    fireEvent(screen.getByLabelText('First one in'), 'longPress');
    fireEvent.press(screen.getByLabelText('❤️'));
    expect(onToggleReaction).toHaveBeenCalledWith('m1', '❤️', false);
  });

  it('does not open for somebody who cannot react', () => {
    renderThread({ canReact: false });
    fireEvent(screen.getByLabelText('First one in'), 'longPress');
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
  });
});

describe('what a group needs and a one-to-one chat does not', () => {
  it('names the sender above their first bubble, and not on your own', () => {
    render(
      <MessageThread
        messages={[message({ id: 'm2', sender_id: 'me', body: 'mine' }), message()]}
        ownUserId="me"
        reactions={[]}
        onToggleReaction={jest.fn()}
        authorFor={() => 'Priya'}
      />
    );
    expect(screen.getByText('Priya')).toBeTruthy();
    expect(screen.queryAllByText('Priya')).toHaveLength(1);
  });

  it('prints a note in place of a message a host took down', () => {
    renderThread({ noteFor: () => 'Message removed by the host' });
    expect(screen.getByText('Message removed by the host')).toBeTruthy();
    // And there is nothing left to react to.
    fireEvent(screen.getByText('Message removed by the host'), 'longPress');
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
  });
});
