import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PhotoViewer } from '@/components/ui/photo-viewer';
import { Sheet, SHEET_SETTLE_MS, usePresentedModalCount } from '@/components/ui/sheet';

// The suite's gesture stub covers Pan, Tap, LongPress and Simultaneous —
// the surface the app had before this component. The viewer adds a pinch and
// an exclusive composition, so the surface is widened HERE rather than in
// jest.setup.js: the setup file's own rule is that a component needing more
// than the shared stub brings its own, and this keeps every other test
// rendering a viewer (ProfileView mounts one) on the smaller lie.
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
      // This file renders a Sheet too, and the sheet's pull now declares a
      // downward dead zone so the card-wide drag target cannot steal a tap.
      'activeOffsetY',
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

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

const photo = { uri: 'https://signed.example/rooftop.jpg', label: 'Mara, photo 2 of 5' };

/** Reads the collision count out loud, so a test can watch the viewer hold it. */
function Claim() {
  return <Text>{`modals ${usePresentedModalCount()}`}</Text>;
}

describe('the photo viewer', () => {
  it('shows nothing at all until a photo is handed to it', () => {
    render(<PhotoViewer photo={null} onClose={jest.fn()} />);
    expect(screen.queryByLabelText('Close photo')).toBeNull();
    // Not just invisible: the gesture tree, the window size and the claim on
    // the screen are all inactive with no photo, so a screen that merely HAS
    // a viewer is carrying nothing.
    expect(screen.queryByLabelText(photo.label)).toBeNull();
  });

  it('opens on the photo it was given, at full size', () => {
    render(<PhotoViewer photo={photo} onClose={jest.fn()} />);
    const image = screen.getByLabelText('Mara, photo 2 of 5');
    expect(image).toBeTruthy();
    // contain, not cover. The entire reason to open a photo is to see the
    // parts a 1:1 crop was hiding, so a viewer that cropped would be a bigger
    // version of the bug.
    expect(image.props.contentFit).toBe('contain');
  });

  it('never puts a photo behind a public link', () => {
    // The buckets are private by design and every photo in the app is served
    // through a short-lived signed URL. The viewer signs nothing itself — it
    // renders exactly the URL it was handed — so there is no second code path
    // here that could reach a photo any other way.
    render(<PhotoViewer photo={photo} onClose={jest.fn()} />);
    // expo-image normalises `source` to a list.
    expect(screen.getByLabelText('Mara, photo 2 of 5').props.source).toEqual([{ uri: photo.uri }]);
  });

  it('can be closed by something VoiceOver can reach', () => {
    // Pull-down is the gesture, and a gesture is not an affordance: it cannot
    // be discovered, and VoiceOver and Switch Control cannot perform it. The
    // one piece of chrome in here is the door.
    const onClose = jest.fn();
    render(<PhotoViewer photo={photo} onClose={onClose} />);
    fireEvent.press(screen.getByLabelText('Close photo'));
    expect(onClose).toHaveBeenCalled();
  });

  it('waits for a sheet to finish leaving before it presents', () => {
    jest.useFakeTimers();
    try {
      // The real sequence: a sheet is already on screen, and a photo inside
      // it is tapped. iOS silently drops a modal presentation that begins
      // while another is dismissing, and on Fabric that does not lose the
      // modal — it leaves an invisible full-screen view answering every hit
      // test, and the app is dead to touch until relaunch.
      const view = render(
        <>
          <Sheet onClose={jest.fn()}>{null}</Sheet>
          <PhotoViewer photo={null} onClose={jest.fn()} />
        </>
      );

      // Tapped, with the sheet still up: nothing presents into it.
      view.rerender(
        <>
          <Sheet onClose={jest.fn()}>{null}</Sheet>
          <PhotoViewer photo={photo} onClose={jest.fn()} />
        </>
      );
      expect(screen.queryByLabelText('Close photo')).toBeNull();

      // The sheet is gone from React. That is not gone from the SCREEN, which
      // is the whole reason a mount counter alone is not enough — so the
      // viewer is still holding.
      view.rerender(
        <>
          <PhotoViewer photo={photo} onClose={jest.fn()} />
        </>
      );
      expect(screen.queryByLabelText('Close photo')).toBeNull();

      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(screen.getByLabelText('Close photo')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('presents even if the sheet it waited for never leaves', () => {
    // THE DEAD TAP. The gate used to schedule nothing at all while the count
    // was non-zero, so it was not waiting out a dismissal - it was waiting for
    // an event, and an interaction must never depend on an event that might
    // not arrive (traps). Here the sheet simply stays up, which is what the
    // map's pin card does on every screen the app goes to afterwards.
    jest.useFakeTimers();
    try {
      const view = render(
        <>
          <Sheet onClose={jest.fn()}>{null}</Sheet>
          <PhotoViewer photo={null} onClose={jest.fn()} />
        </>
      );
      view.rerender(
        <>
          <Sheet onClose={jest.fn()}>{null}</Sheet>
          <PhotoViewer photo={photo} onClose={jest.fn()} />
        </>
      );
      expect(screen.queryByLabelText('Close photo')).toBeNull();

      act(() => {
        jest.advanceTimersByTime(SHEET_SETTLE_MS + 50);
      });
      expect(screen.getByLabelText('Close photo')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not wait behind an inline sheet, which presents nothing', () => {
    // The map's pin and venue cards. No Modal, so no presentation to drop and
    // nothing to settle - the photo opens in the same frame as the tap.
    jest.useFakeTimers();
    try {
      const view = render(
        <>
          <Sheet inline onClose={jest.fn()}>
            {null}
          </Sheet>
          <PhotoViewer photo={null} onClose={jest.fn()} />
        </>
      );
      view.rerender(
        <>
          <Sheet inline onClose={jest.fn()}>
            {null}
          </Sheet>
          <PhotoViewer photo={photo} onClose={jest.fn()} />
        </>
      );
      expect(screen.getByLabelText('Close photo')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the screen claimed while it fades out', () => {
    // Unmounting the Modal starts a fade-out, and iOS is still dismissing for
    // as long as it runs. A claim that ended on the unmount would tell the
    // next presenter the screen was free while the photo was still on it.
    jest.useFakeTimers();
    try {
      const view = render(
        <>
          <PhotoViewer photo={photo} onClose={jest.fn()} />
          <Claim />
        </>
      );
      expect(screen.getByText('modals 1')).toBeTruthy();

      view.rerender(
        <>
          <PhotoViewer photo={null} onClose={jest.fn()} />
          <Claim />
        </>
      );
      expect(screen.getByText('modals 1')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(SHEET_SETTLE_MS + 50);
      });
      expect(screen.getByText('modals 0')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('makes a second photo wait out its predecessor, and only what is left of it', () => {
    // Two photos in a row, from the same viewer - a gallery, which is most of
    // what this thing is for. The first one's Modal is genuinely still fading
    // when the second is tapped, so there IS something to wait for; what there
    // is not is a fresh window's worth. The gate read the app-wide count in
    // its initializer, found this viewer's own trailing claim in it, and
    // charged the second tap a full SHEET_SETTLE_MS on top of the part
    // already served.
    jest.useFakeTimers();
    try {
      const other = { uri: 'https://signed.example/market.jpg', label: 'Mara, photo 3 of 5' };
      const view = render(<PhotoViewer photo={photo} onClose={jest.fn()} />);
      expect(screen.getByLabelText('Close photo')).toBeTruthy();

      view.rerender(<PhotoViewer photo={null} onClose={jest.fn()} />);
      act(() => {
        jest.advanceTimersByTime(200);
      });
      view.rerender(<PhotoViewer photo={other} onClose={jest.fn()} />);
      // Still fading, so still nothing presented.
      expect(screen.queryByLabelText('Close photo')).toBeNull();

      // The REMAINDER of the first photo's window, not another whole one.
      act(() => {
        jest.advanceTimersByTime(SHEET_SETTLE_MS - 200);
      });
      expect(screen.getByLabelText(other.label)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('charges nothing at all once its own photo has finished leaving', () => {
    jest.useFakeTimers();
    try {
      const view = render(<PhotoViewer photo={photo} onClose={jest.fn()} />);
      view.rerender(<PhotoViewer photo={null} onClose={jest.fn()} />);
      act(() => {
        jest.advanceTimersByTime(SHEET_SETTLE_MS + 50);
      });
      view.rerender(<PhotoViewer photo={photo} onClose={jest.fn()} />);
      expect(screen.getByLabelText('Close photo')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("gives the second photo its own window to leave in, not the first one's", () => {
    // Open, close, reopen, close, all inside one settle window - a gallery
    // being flicked through and then dismissed. The claim is about whatever
    // Modal is fading NOW, so closing again has to restart the clock; a claim
    // still running on the first photo's deadline drops the screen while the
    // second one is still on it, which is the presentation iOS silently eats.
    jest.useFakeTimers();
    try {
      const other = { uri: 'https://signed.example/market.jpg', label: 'Mara, photo 3 of 5' };
      const view = render(
        <>
          <PhotoViewer photo={photo} onClose={jest.fn()} />
          <Claim />
        </>
      );
      const at = (next: typeof photo | null) =>
        view.rerender(
          <>
            <PhotoViewer photo={next} onClose={jest.fn()} />
            <Claim />
          </>
        );

      at(null);
      act(() => {
        jest.advanceTimersByTime(100);
      });
      at(other);
      act(() => {
        jest.advanceTimersByTime(100);
      });
      at(null);

      // The first photo's window ended 150ms ago. The second one's has not.
      act(() => {
        jest.advanceTimersByTime(400);
      });
      expect(screen.getByText('modals 1')).toBeTruthy();
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(screen.getByText('modals 0')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens straight away when nothing was on screen', () => {
    // The guard costs nothing on the common path. A profile photo is not
    // inside a sheet, and paying out the settle delay on every tap would be a
    // near-half-second stall for a collision that cannot happen.
    jest.useFakeTimers();
    try {
      render(<PhotoViewer photo={photo} onClose={jest.fn()} />);
      expect(screen.getByLabelText('Close photo')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
