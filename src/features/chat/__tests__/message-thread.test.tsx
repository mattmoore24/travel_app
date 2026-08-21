import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FlatList, Keyboard } from 'react-native';

import { MessageThread } from '@/features/chat/message-thread';
import type { MessageRow } from '@/lib/database.types';

// The reaction menu is the founder's headline complaint.
//
// Read this before trusting these tests. An earlier version of this comment
// claimed Maestro's long press "does not drive React Native's Pressable on
// iOS", which is false, and believing it is why a genuine E2E failure was
// waved away once. Maestro delivers a real press. What ate it was the
// thread's own FlatList: with no keyboardShouldPersistTaps it claimed the
// touch in the responder CAPTURE phase while the composer had focus, so the
// bubble was never asked.
//
// These tests cannot see that class of bug at all — fireEvent calls the prop
// directly and never enters the responder system — so their passing says
// nothing about a phone. They pin the handler's LOGIC. The interaction is
// proven by the simulator run, and only there.

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

describe('the list must not eat the press', () => {
  // A weak test on purpose, and worth having anyway: it cannot prove the
  // interaction (see the note at the top of this file), it only stops the one
  // prop that makes the interaction possible from being deleted by somebody
  // tidying up. Without it the FlatList defaults to 'never', takes the touch
  // in the capture phase whenever the composer has focus, and the long press
  // is never scheduled at all.
  it('lets a press through to the bubble while a field is focused', () => {
    renderThread();
    expect(screen.UNSAFE_getByType(FlatList).props.keyboardShouldPersistTaps).toBe('handled');
  });
});

describe('the keyboard gets out of the way first', () => {
  // Messages behaves this way and the founder asked for it. The ordering is
  // the whole trick: the thread stands on a keyboard-sized floor and the list
  // is anchored to its own bottom, so every bubble slides down as the
  // keyboard leaves. Measuring before that slide pins the menu to where the
  // message used to be, which is why this waits rather than racing.
  it('dismisses the keyboard, and does not open until it has gone', () => {
    jest.useFakeTimers();
    const visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    try {
      renderThread();
      fireEvent(screen.getByLabelText('First one in'), 'longPress');

      expect(dismiss).toHaveBeenCalled();
      expect(screen.queryByLabelText('Dismiss')).toBeNull();

      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.getByLabelText('Dismiss')).toBeTruthy();
    } finally {
      visible.mockRestore();
      dismiss.mockRestore();
      jest.useRealTimers();
    }
  });

  it('opens straight away when there is no keyboard to move', () => {
    const visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    try {
      renderThread();
      fireEvent(screen.getByLabelText('First one in'), 'longPress');
      expect(screen.getByLabelText('Dismiss')).toBeTruthy();
      expect(dismiss).not.toHaveBeenCalled();
    } finally {
      visible.mockRestore();
      dismiss.mockRestore();
    }
  });
});
