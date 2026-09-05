import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Sheet, usePresentedModalCount, useScreenOwnerCount } from '@/components/ui/sheet';

/**
 * Two counts, and the whole point is that they answer different questions.
 *
 * The collision count is "how many native modals are up", because iOS drops a
 * presentation that begins while another is dismissing and on Fabric that
 * kills touch for the whole app. The screen-owner count is "is somebody
 * already looking at something", which an inline sheet is and a collision it
 * is not.
 *
 * They were one number until 2026-09-01, and the map paid for it: its pin and
 * venue cards are `<Sheet inline>`, nothing clears them on blur, so the count
 * sat at 1 on every screen the app visited afterwards and the photo viewer -
 * which reads it for a collision - never presented again.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Counts() {
  return <Text>{`modals ${usePresentedModalCount()}, owners ${useScreenOwnerCount()}`}</Text>;
}

function Host({ sheet }: { sheet: 'none' | 'modal' | 'inline' }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      {sheet === 'none' ? null : (
        <Sheet inline={sheet === 'inline'} onClose={() => {}}>
          {null}
        </Sheet>
      )}
      <Counts />
    </SafeAreaProvider>
  );
}

describe('what a sheet declares about the screen', () => {
  it('counts nothing when there is no sheet', () => {
    render(<Host sheet="none" />);
    expect(screen.getByText('modals 0, owners 0')).toBeTruthy();
  });

  it('counts a presented sheet as both a modal and the screen', () => {
    render(<Host sheet="modal" />);
    expect(screen.getByText('modals 1, owners 1')).toBeTruthy();
  });

  it('counts an inline sheet as the screen and NOT as a modal', () => {
    // `inline` renders no Modal at all, so there is no presentation for the
    // next one to collide with. It is still what somebody is reading, which is
    // why it keeps the second count.
    render(<Host sheet="inline" />);
    expect(screen.getByText('modals 0, owners 1')).toBeTruthy();
  });

  it('gives the count back when the sheet goes', () => {
    const view = render(<Host sheet="modal" />);
    view.rerender(<Host sheet="none" />);
    expect(screen.getByText('modals 0, owners 0')).toBeTruthy();
  });
});
