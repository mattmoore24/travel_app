import { render, screen } from '@testing-library/react-native';

import { HoursSlider } from '@/components/form/hours-slider';

/**
 * The slider is one adjustable element with a spoken name and value, or it
 * is nothing: a View carries an accessibilityLabel on iOS only when it is
 * `accessible`, and until E2E run 122 this one was not, so VoiceOver landed
 * on the readout's text and was offered no control to adjust.
 */
describe('HoursSlider', () => {
  it('is one accessible adjustable carrying its label and its value', () => {
    render(
      <HoursSlider
        value={9}
        min={1}
        max={72}
        onChange={() => {}}
        formatValue={(hours) => `${hours} hours`}
        accessibilityLabel="How long this pin stays up"
      />
    );
    const slider = screen.getByLabelText('How long this pin stays up');
    expect(slider.props.accessible).toBe(true);
    expect(slider.props.accessibilityRole).toBe('adjustable');
    expect(slider.props.accessibilityValue).toEqual({ min: 1, max: 72, now: 9, text: '9 hours' });
    expect(slider.props.accessibilityActions).toEqual([
      { name: 'increment' },
      { name: 'decrement' },
    ]);
  });
});
