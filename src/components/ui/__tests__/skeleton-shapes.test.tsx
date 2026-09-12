import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  FormSkeleton,
  ProfileHeroSkeleton,
  RowSkeleton,
  Skeleton,
  ThreadSkeleton,
} from '@/components/ui/skeleton';
import { Radius } from '@/constants/theme';

/**
 * The shared shapes, and the two properties of them that are easy to lose:
 * a thread placeholder inside an inverted list has to undo the list's
 * mirror itself, and a text-line placeholder has to be as tall as the text
 * that will replace it.
 *
 * useWindowDimensions is mocked at its module, because React Native's own
 * jest DeviceInfo reports fontScale 2 and these need to move it.
 */

let mockFontScale = 1;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

const rootStyle = () => {
  const json = screen.toJSON();
  if (json == null || Array.isArray(json)) {
    throw new Error('expected one root element');
  }
  return StyleSheet.flatten(json.props.style) as Record<string, unknown>;
};

beforeEach(() => {
  mockFontScale = 1;
});

describe('ThreadSkeleton', () => {
  it('is four bubbles, alternating sides, in one View', () => {
    render(<ThreadSkeleton />);
    const bubbles = screen.UNSAFE_getAllByType(Skeleton);
    expect(bubbles.map((b) => b.props.width)).toEqual(['62%', '48%', '70%', '40%']);
    expect(bubbles.map((b) => StyleSheet.flatten(b.props.style).alignSelf)).toEqual([
      'flex-start',
      'flex-end',
      'flex-start',
      'flex-end',
    ]);
    for (const bubble of bubbles) {
      expect(bubble.props.height).toBe(40);
      expect(bubble.props.radius).toBe(Radius.bubble);
    }
    expect(rootStyle().transform).toBeUndefined();
  });

  it("undoes an inverted list's mirror itself, because the list's counter-flip never reaches it", () => {
    // VirtualizedList clones its empty component with the inversion style
    // as a `style` prop; a component that takes no style drops it and
    // renders upside down. So the flip is explicit, on the one View.
    render(<ThreadSkeleton inverted />);
    expect(rootStyle().transform).toEqual([{ scaleY: -1 }]);
  });
});

describe('a text-line placeholder follows Dynamic Type', () => {
  it('is as tall as the line it stands in for', () => {
    mockFontScale = 1.6;
    render(<Skeleton height={14} text />);
    expect(rootStyle().height).toBe(Math.round(14 * 1.6));
  });

  it('leaves a block that is not text alone', () => {
    mockFontScale = 1.6;
    render(<Skeleton height={14} />);
    expect(rootStyle().height).toBe(14);
  });

  it('stops at twice the default and never shrinks below it', () => {
    mockFontScale = 3.1;
    render(<Skeleton height={14} text />);
    expect(rootStyle().height).toBe(28);
    screen.unmount();
    mockFontScale = 0.8;
    render(<Skeleton height={14} text />);
    expect(rootStyle().height).toBe(14);
  });
});

describe('the other shapes', () => {
  it('RowSkeleton is one full-width row at 56, or the height it is given', () => {
    render(<RowSkeleton />);
    const [row] = screen.UNSAFE_getAllByType(Skeleton);
    expect(row.props.width).toBe('100%');
    expect(row.props.height).toBe(56);
    expect(row.props.radius).toBe(Radius.md);
    screen.unmount();
    render(<RowSkeleton height={72} />);
    expect(screen.UNSAFE_getAllByType(Skeleton)[0].props.height).toBe(72);
  });

  it('FormSkeleton is a label line over a field, per group', () => {
    render(<FormSkeleton groups={3} />);
    const bars = screen.UNSAFE_getAllByType(Skeleton);
    expect(bars).toHaveLength(6);
    expect(bars[0].props).toMatchObject({ width: '30%', height: 12, text: true });
    expect(bars[1].props).toMatchObject({ width: '100%', height: 52 });
  });

  it('ProfileHeroSkeleton is the hero ratio and three text lines', () => {
    render(<ProfileHeroSkeleton />);
    const bars = screen.UNSAFE_getAllByType(Skeleton);
    expect(bars).toHaveLength(4);
    // A ratio of the width, never a fixed height: a hardcoded hero is right
    // on one phone and kicks everything below it down on every other.
    expect(bars[0].props).toMatchObject({ aspectRatio: 1 / 1.15, radius: 0 });
    expect(bars[0].props.height).toBeUndefined();
    expect(bars.slice(1).map((b) => [b.props.width, b.props.height, b.props.text])).toEqual([
      ['55%', 20, true],
      ['80%', 14, true],
      ['70%', 14, true],
    ]);
  });
});
