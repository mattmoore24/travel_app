import { render } from '@testing-library/react-native';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * DESIGN.md:112 promises "Everything respects Reduce Motion", and the
 * skeleton pulse is one of the app's only two infinite loops (the intro
 * tour's breathing glow is the other, gated the same way). With the OS
 * switch on, the pulse must never even start - it holds at its mid point.
 *
 * A per-file Reanimated mock, because the global stub in jest.setup.js pins
 * useReducedMotion to false and this test needs to flip it.
 */

let mockReduced = false;
const mockWithRepeat = jest.fn();

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { View } = require('react-native');
  const AnimatedView = React.forwardRef((props: object, ref: unknown) =>
    React.createElement(View, { ...props, ref })
  );
  AnimatedView.displayName = 'Animated(View)';
  return {
    __esModule: true,
    default: { View: AnimatedView },
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (factory: () => object) => factory(),
    useReducedMotion: () => mockReduced,
    withTiming: (to: unknown) => to,
    withRepeat: (...args: unknown[]) => {
      mockWithRepeat(...args);
      return args[0];
    },
  };
});

beforeEach(() => {
  mockWithRepeat.mockClear();
});

describe('Skeleton under Reduce Motion', () => {
  it('never starts the infinite pulse when Reduce Motion is on', () => {
    mockReduced = true;
    render(<Skeleton width={48} height={48} />);
    expect(mockWithRepeat).not.toHaveBeenCalled();
  });

  it('pulses forever, symmetrically, when it is off', () => {
    mockReduced = false;
    render(<Skeleton width={48} height={48} />);
    expect(mockWithRepeat).toHaveBeenCalledTimes(1);
    // -1 repeats, reversing - the loop this test exists to gate.
    expect(mockWithRepeat.mock.calls[0][1]).toBe(-1);
    expect(mockWithRepeat.mock.calls[0][2]).toBe(true);
  });
});
