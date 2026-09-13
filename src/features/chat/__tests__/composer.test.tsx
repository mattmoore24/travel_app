import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { AccessibilitySizesFrom, Space } from '@/constants/theme';
import { Composer } from '@/features/chat/composer';

/**
 * The composer's inset and its placeholder, at the accessibility sizes.
 *
 * E2E run 142 (zz-ax5-07) photographed two things in the room composer. The
 * row padded 24 on top of a room wrapper that padded 16, so the field was
 * 222pt of a 402pt screen at every text size while the one-to-one thread,
 * with no wrapper, was inset 24. And "Message the group…", drawn by a
 * UILabel with numberOfLines 0, broke mid-word into "Messag" / "e the" /
 * "group…" once the type reached 46.8pt. A component test cannot see a
 * pixel; it can pin the two rules that fix the frame: the row owns ONE
 * 16pt inset, the same one the bubbles and the banner use, and from the
 * accessibility line the drawn placeholder is the one word "Message" while
 * the spoken one keeps the whole string.
 */

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

// The real button opens the system picker. A stub that answers with a file
// on press is enough to reach the staged-photo branch, which is where the
// placeholder changes to "Add a message…".
jest.mock('@/components/ui/photo-button', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { Pressable } = require('react-native');
  return {
    PhotoButton: ({ onPick }: { onPick: (uri: string) => void }) =>
      React.createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Add a photo',
        onPress: () => onPick('file://x'),
      }),
  };
});

beforeEach(() => {
  mockFontScale = 1;
});

const flatten = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) as ViewStyle;

/**
 * The nearest host View above `node` whose flattened style passes `test`.
 * The field sits inside KeyboardDone's fragment, so its immediate parent is
 * not the row; walk up until the row is found, and fail loudly if it is not.
 */
const closestView = (node: ReactTestInstance, test: (style: ViewStyle) => boolean) => {
  let current: ReactTestInstance | null = node.parent;
  while (current) {
    if ((current.type as unknown) === 'View' && test(flatten(current))) {
      return current;
    }
    current = current.parent;
  }
  throw new Error('no View above the node passed the test');
};

const field = () => screen.getByTestId('room-composer');

const renderRoomComposer = (extra: Partial<React.ComponentProps<typeof Composer>> = {}) =>
  render(
    <Composer
      inputTestID="room-composer"
      placeholder="Message the group…"
      onSend={jest.fn()}
      {...extra}
    />
  );

describe('one inset, owned by the row', () => {
  it('pads the row Space.lg each side, the bubbles above it and the messengers people use', () => {
    renderRoomComposer();
    const row = closestView(field(), (style) => style.flexDirection === 'row');
    expect(flatten(row).paddingHorizontal).toBe(Space.lg);
  });

  it('gives the reply banner the same inset, so it shares the field left edge', () => {
    renderRoomComposer({ replyingTo: { name: 'Maya', body: 'hi' } });
    const banner = closestView(
      screen.getByText('Replying to Maya'),
      (style) => style.borderLeftWidth === 2
    );
    expect(flatten(banner).marginHorizontal).toBe(Space.lg);
  });
});

describe('the placeholder', () => {
  it('draws the whole string at the standard sizes', () => {
    renderRoomComposer();
    expect(field().props.placeholder).toBe('Message the group…');
    expect(field().props.accessibilityLabel).toBe('Message the group');
  });

  it('still draws the whole string at xxxLarge, the last standard size', () => {
    mockFontScale = 1.35;
    renderRoomComposer();
    expect(field().props.placeholder).toBe('Message the group…');
    expect(field().props.accessibilityLabel).toBe('Message the group');
  });

  it('shortens to one word from exactly the accessibility line, and keeps its spoken name', () => {
    mockFontScale = AccessibilitySizesFrom;
    renderRoomComposer();
    expect(field().props.placeholder).toBe('Message');
    expect(field().props.accessibilityLabel).toBe('Message the group');
  });

  it('is one word at AX5, with no ellipsis to break on', () => {
    mockFontScale = 3.12;
    renderRoomComposer();
    expect(field().props.placeholder).toBe('Message');
    expect(field().props.accessibilityLabel).toBe('Message the group');
  });

  it('defaults to "Message…" below the line when the screen passes none', () => {
    render(<Composer inputTestID="room-composer" onSend={jest.fn()} />);
    expect(field().props.placeholder).toBe('Message…');
    expect(field().props.accessibilityLabel).toBe('Message');
  });
});

describe('with a photo staged', () => {
  it('asks for the caption below the line', () => {
    renderRoomComposer();
    fireEvent.press(screen.getByLabelText('Add a photo'));
    // The staged photo is really there: its own remove control has mounted.
    expect(screen.getByLabelText('Remove photo')).toBeTruthy();
    expect(field().props.placeholder).toBe('Add a message…');
    expect(field().props.accessibilityLabel).toBe('Add a message');
  });

  it('is still the one word from the line, and still spoken in full', () => {
    mockFontScale = 1.65;
    renderRoomComposer();
    fireEvent.press(screen.getByLabelText('Add a photo'));
    expect(field().props.placeholder).toBe('Message');
    expect(field().props.accessibilityLabel).toBe('Add a message');
  });
});
