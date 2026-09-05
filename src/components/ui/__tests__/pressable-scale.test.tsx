import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { haptics } from '@/lib/haptics';

/**
 * The haptic rule PressableScale's own doc comment states: a haptic on
 * touch-down is right for a button and wrong for anything you might be about
 * to scroll past - 'none' exists for rows inside scrollers, and it has to
 * mean none. Two call sites broke it (the featured traveler card and the
 * venue stack rows), which is how scrolling came to buzz.
 *
 * Jest cannot feel a haptic, so this pins the rule, not the feel: the device
 * half of the check is walked once - scroll the venue stack and the guest
 * Travelers page and feel nothing.
 */

jest.mock('@/lib/haptics', () => ({
  haptics: {
    selection: jest.fn(),
    soft: jest.fn(),
    light: jest.fn(),
    medium: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

const calls = () =>
  Object.values(haptics).reduce((n, fn) => n + (fn as jest.Mock).mock.calls.length, 0);

beforeEach(() => jest.clearAllMocks());

describe('PressableScale haptics', () => {
  it('fires nothing at all on press-in with haptic="none"', () => {
    render(
      <PressableScale haptic="none" onPress={() => {}}>
        <Text>Row in a scroller</Text>
      </PressableScale>
    );
    fireEvent(screen.getByText('Row in a scroller'), 'pressIn');
    expect(calls()).toBe(0);
  });

  it('and none by default, which is what makes the default safe in lists', () => {
    render(
      <PressableScale onPress={() => {}}>
        <Text>Default row</Text>
      </PressableScale>
    );
    fireEvent(screen.getByText('Default row'), 'pressIn');
    expect(calls()).toBe(0);
  });

  it('still speaks when a real control asks for it', () => {
    render(
      <PressableScale haptic="soft" onPress={() => {}}>
        <Text>Button</Text>
      </PressableScale>
    );
    fireEvent(screen.getByText('Button'), 'pressIn');
    expect(haptics.soft).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(1);
  });
});
