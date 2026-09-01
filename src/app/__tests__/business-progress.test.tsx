import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { StepShell } from '@/features/signup/step-shell';
import { BUSINESS_TOTAL_STEPS, SIGNUP_TOTAL_STEPS } from '@/features/signup/steps';

/**
 * The progress bar, which carried no number for anybody.
 *
 * It was two plain Views with no accessibilityRole, no accessibilityValue and
 * no text alternative, so a VoiceOver user swiping thirteen screens got a Back
 * button and a form and no idea how much was left. Sighted users got a 4pt
 * hairline. Both halves are fixed here and both are asserted, because either
 * one alone leaves somebody counting screens.
 *
 * This lives under app/__tests__ rather than beside the component because the
 * numbering it pins down is the business flow's: /join used to hand both
 * account kinds SIGNUP_TOTAL_STEPS, so a business read 1/13, 2/13 and then
 * 3/12, and the bar jumped backwards in meaning.
 */

// StepShell docks its button above the keyboard and reads the safe area.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const show = (step: number, total: number) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <StepShell step={step} total={total} title="Who are you?" onContinue={jest.fn()}>
        <ThemedText>a field</ThemedText>
      </StepShell>
    </SafeAreaProvider>
  );

describe('the signup progress bar', () => {
  it('is a progressbar VoiceOver can read, with the step in its label', () => {
    show(5, SIGNUP_TOTAL_STEPS);
    const bar = screen.getByRole('progressbar');
    expect(bar.props.accessibilityLabel).toBe('Step 5 of 13');
    // min 0, because React Native speaks now / (max - min) and does NOT
    // subtract min from now - Paper at React/Views/RCTView.m:393, Fabric in
    // RCTViewComponentView.mm. With min 1 the last of thirteen steps
    // announced 108 percent while the bar drew 100. min 0 makes the same
    // formula produce step/total, which is exactly what the fill draws.
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 13, now: 5 });
    // The property that matters, stated as arithmetic rather than as a
    // constant, so a future edit to either number has to keep them agreeing.
    const { min, max, now } = bar.props.accessibilityValue;
    expect(now / (max - min)).toBeCloseTo(5 / 13);
    expect(13 / (max - min)).toBeLessThanOrEqual(1);
  });

  it('prints the same number where a sighted reader can see it', () => {
    show(5, SIGNUP_TOTAL_STEPS);
    expect(screen.getByText('5 of 13')).toBeTruthy();
  });

  it('counts a business flow to thirteen as well', () => {
    // The last screen of the business sequence is the emailed code, on its
    // own route. It used to be drawn with no bar at all, one screen after the
    // bar had already filled.
    show(BUSINESS_TOTAL_STEPS, BUSINESS_TOTAL_STEPS);
    expect(screen.getByRole('progressbar').props.accessibilityLabel).toBe('Step 13 of 13');
    expect(screen.getByText('13 of 13')).toBeTruthy();
  });
});

describe('the business step count', () => {
  it('is thirteen, counting the code screen on its own route', () => {
    expect(BUSINESS_TOTAL_STEPS).toBe(13);
  });
});
