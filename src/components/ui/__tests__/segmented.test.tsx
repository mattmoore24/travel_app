import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Segmented } from '@/components/ui/segmented';
import { HitTarget } from '@/constants/theme';

/**
 * The tabs have to be worth touching.
 *
 * A 36pt track with 3pt of padding leaves each tab 30pt tall, ten under the
 * 44pt floor, and this control now carries the whole of two date surfaces -
 * where hitting the tab next to the one you meant is a trip with the wrong
 * dates on it. The track keeps the height it looks right at; the target grows
 * past it, the way the verified seal and the photo grid's remove dot do.
 */

const OPTIONS = [
  { value: 'exact' as const, label: 'Exact dates' },
  { value: 'rough' as const, label: 'Roughly when' },
];

describe('the segmented control', () => {
  it('gives every tab a 44pt target', () => {
    render(
      <Segmented
        options={OPTIONS}
        value="exact"
        onChange={jest.fn()}
        accessibilityLabel="How your dates work"
      />
    );

    const tab = screen.getByLabelText('Roughly when');
    const slop = tab.props.hitSlop;
    // Vertical only. Sideways slop would reach into the neighbouring tab, and
    // switching to the wrong one is the failure this is here to prevent.
    expect(slop.left).toBeUndefined();
    expect(slop.right).toBeUndefined();

    // The tab is the track's height less its padding on both sides, and the
    // slop is added above and below that.
    const track = StyleSheet.flatten(screen.getByLabelText('How your dates work').props.style);
    const tabHeight = (track.minHeight as number) - (track.padding as number) * 2;
    expect(tabHeight + slop.top + slop.bottom).toBeGreaterThanOrEqual(HitTarget);
  });

  it('lets the labels grow rather than clipping them', () => {
    // Dynamic Type is live everywhere in this app, and a fixed box cuts the
    // words off at the larger sizes.
    render(
      <Segmented
        options={OPTIONS}
        value="exact"
        onChange={jest.fn()}
        accessibilityLabel="How your dates work"
      />
    );
    const track = StyleSheet.flatten(screen.getByLabelText('How your dates work').props.style);
    expect(track.height).toBeUndefined();
    expect(track.minHeight).toBe(36);
  });

  it('reports the tab that is on, and switches to the other', () => {
    const onChange = jest.fn();
    render(<Segmented options={OPTIONS} value="exact" onChange={onChange} />);

    expect(screen.getByLabelText('Exact dates').props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByLabelText('Roughly when'));
    expect(onChange).toHaveBeenCalledWith('rough');
  });
});
