import { fireEvent, render, screen } from '@testing-library/react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ChipRail } from '@/components/form/chip-rail';
import { PrimaryButton } from '@/components/form/primary-button';
import { DockedActionBar } from '@/components/ui/docked-action-bar';
import { Segmented } from '@/components/ui/segmented';
import { FontCap } from '@/constants/theme';

/**
 * Tappable chrome at the accessibility sizes: the label is capped at
 * FontCap.control, held to a line count, and the box around it is a
 * minimum, never a fixed height. Each control's own file explains its
 * shape; this pins the four of them to the same rule so one cannot drift.
 */

jest.mock('expo-linear-gradient', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { View } = require('react-native');
  return { LinearGradient: (props: object) => React.createElement(View, props) };
});

describe('PrimaryButton', () => {
  it('wraps to two lines and then gives way, rather than running past the pill', () => {
    render(<PrimaryButton label="Send a message to Lorenzo" onPress={jest.fn()} />);
    const label = screen.getByText('Send a message to Lorenzo');
    expect(label.props.numberOfLines).toBe(2);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    // Uncapped unless a bar with a derived plate says otherwise.
    expect(label.props.maxFontSizeMultiplier).toBeUndefined();
  });

  it('still takes a cap from a bar that needs one', () => {
    render(<PrimaryButton label="Say hi" onPress={jest.fn()} maxFontSizeMultiplier={1.4} />);
    expect(screen.getByText('Say hi').props.maxFontSizeMultiplier).toBe(1.4);
  });
});

describe('DockedActionBar', () => {
  it('caps its primary at the control cap by default, and forwards another', () => {
    render(<DockedActionBar primaryLabel="Say hi" onPrimary={jest.fn()} bottomInset={34} />);
    expect(screen.getByText('Say hi').props.maxFontSizeMultiplier).toBe(FontCap.control);
    screen.unmount();
    render(
      <DockedActionBar
        primaryLabel="Say hi"
        onPrimary={jest.fn()}
        bottomInset={34}
        maxFontSizeMultiplier={2}
      />
    );
    expect(screen.getByText('Say hi').props.maxFontSizeMultiplier).toBe(2);
  });

  it('forwards loading to the primary, which spins instead of greying', () => {
    const onPrimary = jest.fn();
    render(
      <DockedActionBar primaryLabel="Say hi" onPrimary={onPrimary} bottomInset={34} loading />
    );
    expect(screen.UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
    expect(screen.queryByText('Say hi')).toBeNull();
    const button = screen.getByRole('button');
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    fireEvent.press(button);
    expect(onPrimary).not.toHaveBeenCalled();
  });
});

describe('Segmented', () => {
  const OPTIONS = [
    { value: 'chats' as const, label: 'Chats', badge: 3 },
    { value: 'groups' as const, label: 'Groups' },
  ];

  it('holds each label to one capped line and shrinks it before it clips', () => {
    render(<Segmented options={OPTIONS} value="chats" onChange={jest.fn()} />);
    for (const label of ['Chats', 'Groups']) {
      const text = screen.getByText(label);
      expect(text.props.maxFontSizeMultiplier).toBe(FontCap.control);
      expect(text.props.numberOfLines).toBe(1);
      expect(text.props.adjustsFontSizeToFit).toBe(true);
      expect(text.props.minimumFontScale).toBe(0.8);
    }
  });

  it('lets the unread pill grow with its digits instead of clipping them', () => {
    render(<Segmented options={OPTIONS} value="chats" onChange={jest.fn()} />);
    expect(screen.getByText('3').props.maxFontSizeMultiplier).toBe(FontCap.control);
    const pill = screen
      .UNSAFE_getAllByType(View)
      .map((view) => StyleSheet.flatten(view.props.style) as Record<string, unknown>)
      .find((style) => style?.borderRadius === 9);
    expect(pill).toBeDefined();
    expect(pill?.height).toBeUndefined();
    expect(pill?.minHeight).toBe(18);
    expect(pill?.paddingVertical).toBe(1);
  });
});

describe('ChipRail', () => {
  it('caps the chip label at the control cap on one line', () => {
    render(
      <ChipRail
        options={[{ value: 'today', label: 'Today' }]}
        selected="today"
        onSelect={jest.fn()}
      />
    );
    const label = screen.getByText('Today');
    expect(label.props.maxFontSizeMultiplier).toBe(FontCap.control);
    expect(label.props.numberOfLines).toBe(1);
  });
});
