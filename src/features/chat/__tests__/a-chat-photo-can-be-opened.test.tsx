import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MessageThread } from '@/features/chat/message-thread';
import type { MessageRow } from '@/lib/database.types';

/**
 * The half of the photo viewer that was missing: a caller.
 *
 * PhotoViewer shipped with a header comment arguing its whole design around
 * the chat-photos bucket, and the chat thread drew photos as a fixed 220
 * square with contentFit cover and no press target at all. So a landscape
 * photo of the meeting spot was a centre-cropped middle third that neither
 * side could open, and the component written for it had two callers on the
 * profile and none here.
 *
 * These press the photo the way a person does and assert the viewer arrives.
 * They cannot prove the gesture reaches the bubble on a device - fireEvent
 * calls the prop directly and never enters the responder system, which is the
 * caveat the sibling thread test spells out - but they do prove the wiring
 * exists, which is the defect that shipped.
 */

// The shared gesture stub in jest.setup covers the surface the app had before
// the viewer existed. The viewer adds a pinch and an exclusive composition,
// so the surface is widened here rather than there, matching the rule the
// viewer's own test records.
jest.mock('react-native-gesture-handler', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');

  const builder = () => {
    const chain: Record<string, () => unknown> = {};
    for (const key of [
      'onUpdate',
      'onEnd',
      'onBegin',
      'onStart',
      'onFinalize',
      'enabled',
      'numberOfTaps',
      'maxDuration',
    ]) {
      chain[key] = () => chain;
    }
    return chain;
  };

  return {
    __esModule: true,
    Gesture: {
      Pan: builder,
      Pinch: builder,
      Tap: builder,
      LongPress: builder,
      Simultaneous: builder,
      Exclusive: builder,
      Race: builder,
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: ({ children, ...rest }: { children: React.ReactNode }) =>
      React.createElement(View, rest, children),
    State: {},
    Directions: {},
  };
});

// A chat photo is signed against `chat-photos`, which is a different bucket
// from the one usePhotoUrl signs. That split is the reason the viewer signs
// nothing itself and takes a URL from whoever has it.
jest.mock('@/features/chat/hooks', () => ({
  useChatPhotoUrl: (path: string | null) =>
    path ? { data: `https://signed.example/${path}` } : { data: null },
}));

jest.mock('@/features/profile/hooks', () => ({
  usePhotoUrl: () => ({ data: null }),
}));

jest.mock('@/features/rooms/hooks', () => ({
  useJoinPlanFromMessage: () => ({ mutate: jest.fn(), isPending: false, isSuccess: false }),
  useReactors: () => ({ data: [], isPending: false, isError: false }),
}));

jest.mock('@/features/business/hooks', () => ({
  useIsBusiness: () => false,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const photoMessage = (over: Partial<MessageRow> = {}): MessageRow =>
  ({
    id: 'm1',
    chat_id: 'c1',
    sender_id: 'them',
    body: null,
    image_path: 'c1/rooftop.jpg',
    created_at: new Date('2026-08-21T11:07:00Z').toISOString(),
    ...over,
  }) as MessageRow;

function renderThread(props: Partial<Parameters<typeof MessageThread>[0]> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MessageThread
        messages={[photoMessage()]}
        ownUserId="me"
        otherName="Mara"
        reactions={[]}
        onToggleReaction={jest.fn()}
        {...props}
      />
    </SafeAreaProvider>
  );
}

describe('a photo in a chat can be looked at', () => {
  it('is a press target, and the press opens the viewer', () => {
    renderThread();
    // Nothing is presented until somebody asks for it.
    expect(screen.queryByLabelText('Close photo')).toBeNull();

    fireEvent.press(screen.getByTestId('photo-m1'));

    // The viewer's only chrome, and the thing that proves it mounted.
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
  });

  it('says whose photo it is, because VoiceOver has to name it', () => {
    renderThread();
    fireEvent.press(screen.getByTestId('photo-m1'));
    expect(screen.getByLabelText('Photo from Mara')).toBeTruthy();
  });

  it('names your own the other way round', () => {
    renderThread({ messages: [photoMessage({ sender_id: 'me' })] });
    fireEvent.press(screen.getByTestId('photo-m1'));
    expect(screen.getByLabelText('Photo you sent')).toBeTruthy();
  });

  it('closes again', () => {
    renderThread();
    fireEvent.press(screen.getByTestId('photo-m1'));
    fireEvent.press(screen.getByTestId('photo-viewer-close'));
    expect(screen.queryByLabelText('Close photo')).toBeNull();
  });

  it('offers the same door to VoiceOver, which cannot reach inside the bubble', () => {
    // A Pressable carrying an accessibilityLabel is one element on iOS and its
    // children stop being elements at all, so the press target above is
    // unreachable by touch there. The rotor action on the bubble is the only
    // way in, which is why it is asserted rather than assumed.
    renderThread();
    const bubble = screen.getByLabelText('Photo');
    expect(bubble.props.accessibilityActions).toContainEqual({
      name: 'openPhoto',
      label: 'Open photo',
    });
    fireEvent(bubble, 'accessibilityAction', { nativeEvent: { actionName: 'openPhoto' } });
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
  });

  it('reserves the photo its space before it lands, and never takes it back', () => {
    // An inverted list is anchored to its own bottom, so a cell that changed
    // height when its photo arrived would slide every message above it down
    // the screen - the thread moving under the reader's finger, a beat after
    // they opened it. The frame that followed the loaded aspect collapsed a
    // 16:9 photo from 220 to 124 and took ~96pt of the cell with it.
    renderThread();
    const before = StyleSheet.flatten(screen.getByTestId('photo-m1-image').props.style);
    expect(before.width).toBe(220);
    expect(before.height).toBe(220);

    act(() => {
      // expo-image unwraps `nativeEvent` before it reaches onLoad, so the
      // payload is shaped the way the native view sends it.
      fireEvent(screen.getByTestId('photo-m1-image'), 'load', {
        nativeEvent: { source: { width: 1600, height: 900 } },
      });
    });

    const after = StyleSheet.flatten(screen.getByTestId('photo-m1-image').props.style);
    expect(after.height).toBe(220);
    // Too wide for the column, so it keeps the reserved square and is drawn
    // WHOLE inside it. contain, never cover: cover is the centre crop that
    // hid two thirds of the meeting spot in the first place.
    expect(after.width).toBe(220);
    expect(screen.getByTestId('photo-m1-image').props.contentFit).toBe('contain');
  });

  it("takes a portrait photo's shape sideways, where nothing is anchored", () => {
    // Width is free to move: it changes what the bubble looks like and cannot
    // move a single row of the list.
    renderThread();
    act(() => {
      fireEvent(screen.getByTestId('photo-m1-image'), 'load', {
        nativeEvent: { source: { width: 900, height: 1200 } },
      });
    });
    const frame = StyleSheet.flatten(screen.getByTestId('photo-m1-image').props.style);
    expect(frame.height).toBe(220);
    expect(frame.width).toBe(165);
  });

  it('does not offer a photo that is still being checked', () => {
    // A held photo draws a review tile and nothing else, so an action that
    // opened it would be an action that lies about what it does.
    renderThread({ messages: [photoMessage({ moderation_status: 'pending' } as never)] });
    expect(screen.queryByTestId('photo-m1')).toBeNull();
    expect(screen.getByLabelText('Photo').props.accessibilityActions).toBeUndefined();
  });
});
