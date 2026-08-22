import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Sheet, SHEET_SETTLE_MS } from '@/components/ui/sheet';
import { usePushPrimer } from '@/features/notifications/primer-store';
import { PushPrimer } from '@/features/notifications/push-primer';

// The regression these pin down is not "the question did not appear". It is
// "the app stopped responding". Posting a pin unmounts the pin form — a Sheet,
// so a native Modal — and in the same tick useCreatePin.onSuccess asks this
// question, which mounts another Modal. iOS drops a presentation that starts
// while one is still dismissing, and a simulator run photographed the result:
// the confirmation card on screen, four taps registered by the driver, and not
// one pixel changed in the minute that followed.
//
// So what matters here is the ORDER: nothing while a sheet is up, and not for
// SHEET_SETTLE_MS after it goes.

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Host({ sheetUp, inline = false }: { sheetUp: boolean; inline?: boolean }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      {sheetUp ? (
        <Sheet inline={inline} onClose={() => {}}>
          {null}
        </Sheet>
      ) : null}
      <PushPrimer />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  usePushPrimer.setState({ reason: null, busy: false });
});

afterEach(() => {
  jest.useRealTimers();
});

const settle = () => act(() => void jest.advanceTimersByTime(SHEET_SETTLE_MS + 50));

describe('the push primer waits for the screen', () => {
  it('says nothing at all while another sheet is up', () => {
    render(<Host sheetUp />);
    act(() => {
      usePushPrimer.setState({ reason: 'pin-posted' });
    });
    settle();
    expect(screen.queryByText('Want to know if somebody is in?')).toBeNull();
  });

  it('does not arrive the instant the sheet goes, either', () => {
    const view = render(<Host sheetUp />);
    act(() => {
      usePushPrimer.setState({ reason: 'pin-posted' });
    });
    view.rerender(<Host sheetUp={false} />);
    // A frame is not a dismissal. Unmounted in React and gone from the screen
    // are two different facts, and presenting between them is the bug.
    act(() => void jest.advanceTimersByTime(16));
    expect(screen.queryByText('Want to know if somebody is in?')).toBeNull();
  });

  it('asks once the screen has actually settled', () => {
    const view = render(<Host sheetUp />);
    act(() => {
      usePushPrimer.setState({ reason: 'pin-posted' });
    });
    view.rerender(<Host sheetUp={false} />);
    settle();
    expect(screen.getByText('Want to know if somebody is in?')).toBeTruthy();
  });

  it('waits behind an inline sheet too, which it cannot collide with', () => {
    // The pin confirmation card is inline: no Modal, so no presentation to
    // drop. It is still the thing somebody is reading, and dimming it to ask
    // about notifications is a fair question at the worst possible moment.
    render(<Host sheetUp inline />);
    act(() => {
      usePushPrimer.setState({ reason: 'pin-posted' });
    });
    settle();
    expect(screen.queryByText('Want to know if somebody is in?')).toBeNull();
  });

  it('asks straight away when nothing was in the way', () => {
    render(<Host sheetUp={false} />);
    act(() => {
      usePushPrimer.setState({ reason: 'hello-sent' });
    });
    settle();
    expect(screen.getByText('Want to know when they answer?')).toBeTruthy();
  });

  it('goes when the question is withdrawn, and does not come back on its own', () => {
    render(<Host sheetUp={false} />);
    act(() => {
      usePushPrimer.setState({ reason: 'hello-sent' });
    });
    settle();
    expect(screen.getByText('Want to know when they answer?')).toBeTruthy();

    act(() => {
      usePushPrimer.setState({ reason: null });
    });
    settle();
    expect(screen.queryByText('Want to know when they answer?')).toBeNull();
  });
});
