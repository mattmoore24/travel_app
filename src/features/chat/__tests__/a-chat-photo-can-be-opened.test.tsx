import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FailedPhotoGlyph } from '@/components/ui/remote-image';
import { Skeleton } from '@/components/ui/skeleton';
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
let mockSigning = false;
let mockSigningFailed = false;
jest.mock('@/features/chat/hooks', () => ({
  useChatPhotoUrl: (path: string | null) =>
    mockSigningFailed
      ? { data: undefined, isError: true }
      : path && !mockSigning
        ? { data: `https://signed.example/${path}` }
        : { data: undefined },
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

beforeEach(() => {
  mockSigning = false;
});

/**
 * The frame reserves the space and the Image inside it draws the bytes
 * (components/ui/remote-image), so the testID is on the frame and the load
 * event is fired at the Image. RemoteImage hands the event through to the
 * caller unwrapped, the way expo-image hands it to RemoteImage.
 */
const frameStyle = () => StyleSheet.flatten(screen.getByTestId('photo-m1-image').props.style);
const loadPhoto = (width: number, height: number) =>
  act(() => {
    screen.UNSAFE_getByType(Image).props.onLoad({ source: { width, height } });
  });

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
    const before = frameStyle();
    expect(before.width).toBe(220);
    expect(before.height).toBe(220);

    loadPhoto(1600, 900);

    const after = frameStyle();
    expect(after.height).toBe(220);
    // Too wide for the column, so it keeps the reserved square and is drawn
    // WHOLE inside it. contain, never cover: cover is the centre crop that
    // hid two thirds of the meeting spot in the first place.
    expect(after.width).toBe(220);
    expect(screen.UNSAFE_getByType(Image).props.contentFit).toBe('contain');
  });

  it("takes a portrait photo's shape sideways, where nothing is anchored", () => {
    // Width is free to move: it changes what the bubble looks like and cannot
    // move a single row of the list.
    renderThread();
    loadPhoto(900, 1200);
    const frame = frameStyle();
    expect(frame.height).toBe(220);
    expect(frame.width).toBe(165);
  });

  it('pulses the reserved square while the URL signs and while the bytes come', () => {
    // The biggest download in the app used to be a flat grey square for
    // both halves of the wait, and a failed one was that square forever.
    mockSigning = true;
    renderThread();
    expect(screen.UNSAFE_queryAllByType(Skeleton)).toHaveLength(1);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
    const signing = frameStyle();
    expect(signing.width).toBe(220);
    expect(signing.height).toBe(220);

    mockSigning = false;
    renderThread();
    // Signed: one Image, keyed on the message so a recycled cell never shows
    // the previous photo, with the skeleton still under it until it lands.
    const images = screen.UNSAFE_getAllByType(Image);
    expect(images).toHaveLength(1);
    expect(images[0].props.recyclingKey).toBe('m1');
    expect(images[0].props.source.cacheKey).toBe('c1/rooftop.jpg');
    expect(screen.UNSAFE_queryAllByType(Skeleton).length).toBeGreaterThan(0);
    loadPhoto(1200, 1200);
    expect(screen.UNSAFE_queryAllByType(Skeleton)).toHaveLength(0);
  });

  it('withdraws the rotor door when the photo does not come, and offers it again after a retry', () => {
    // "Open photo" on a photo showing the failed glyph would open the viewer
    // on nothing, which is an action that lies about what it does.
    renderThread();
    const bubble = () => screen.getByLabelText('Photo');
    expect(bubble().props.accessibilityActions).toContainEqual({
      name: 'openPhoto',
      label: 'Open photo',
    });
    act(() => {
      screen.UNSAFE_getByType(Image).props.onError({ error: 'no bytes' });
    });
    expect(bubble().props.accessibilityActions).toBeUndefined();
    expect(screen.getByLabelText('Photo could not load')).toBeTruthy();

    loadPhoto(1200, 1200);
    expect(bubble().props.accessibilityActions).toContainEqual({
      name: 'openPhoto',
      label: 'Open photo',
    });
  });

  it('stops pulsing when the signing fails, and says so', () => {
    // The URL never came (offline, or storage refused). Told it was still
    // pending, the frame pulsed for as long as the thread stayed open.
    mockSigningFailed = true;
    try {
      renderThread();
      expect(screen.UNSAFE_queryAllByType(Skeleton)).toHaveLength(0);
      expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
      // The frame stands at its reserved square, with the glyph in it.
      expect(screen.getByTestId('photo-m1-image')).toBeTruthy();
      expect(screen.UNSAFE_getByType(FailedPhotoGlyph)).toBeTruthy();
    } finally {
      mockSigningFailed = false;
    }
  });

  it('still opens the menu on a hold over a photo that did not come', () => {
    // The retry target the failed frame grows is the deepest responder, so
    // without the forwarded hold a photo message whose bytes failed had no
    // reachable Report.
    renderThread({ onReport: jest.fn() });
    fireEvent(screen.getByTestId('photo-m1-image'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 220, height: 220 } },
    });
    act(() => {
      screen.UNSAFE_getByType(Image).props.onError({ error: 'no bytes' });
    });
    const retry = screen.getByLabelText('Photo could not load');
    expect(retry.props.accessibilityRole).toBe('button');
    fireEvent(retry, 'longPress');
    expect(screen.getByLabelText('Report')).toBeTruthy();
  });

  it('does not offer a photo that is still being checked', () => {
    // A held photo draws a review tile and nothing else, so an action that
    // opened it would be an action that lies about what it does.
    renderThread({ messages: [photoMessage({ moderation_status: 'pending' } as never)] });
    expect(screen.queryByTestId('photo-m1')).toBeNull();
    expect(screen.getByLabelText('Photo').props.accessibilityActions).toBeUndefined();
  });
});
