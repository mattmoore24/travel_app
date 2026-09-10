import { render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';

import { Colors } from '@/constants/theme';
import { PinMark } from '@/features/pins/pin-marker';

/**
 * The rules of the one marker drawing.
 *
 * It replaces pin-stack.test.tsx, whose four cases all tested premises this
 * change removed: faces dropped from a row, a collapse rule when none
 * resolved, an Image count per plan, and allowFontScaling === false. A venue
 * stack is now the same amber teardrop every single plan is, carrying a
 * count — which is the whole reason a four-word key can be TRUE about this
 * map. The faces have not gone: they lead the card that opens on tap.
 */

/** Reading a style prop the way RN flattens arrays, so a test is not a lie. */
function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const parts = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...parts.filter((part) => part && typeof part === 'object'));
}

describe('a count pin', () => {
  it('draws the number in one body, with no glyph and no second badge', () => {
    render(<PinMark kind="plan" category="bar" count={7} />);
    expect(screen.getByText('7')).toBeTruthy();
    // The category glyph is REPLACED, not sat beside: a stack that wore both
    // was three circles for two plans.
    expect(screen.UNSAFE_queryAllByType(SymbolView)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('caps at 99+', () => {
    render(<PinMark kind="plan" category="bar" count={150} />);
    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.queryByText('150')).toBeNull();
  });

  it('never wears a face: three people and one photograph names the wrong one', () => {
    render(<PinMark kind="plan" category="bar" count={3} photoUri="https://cdn.test/a.jpg" />);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('scales its number with Dynamic Type, capped rather than refused', () => {
    render(<PinMark kind="plan" category="bar" count={3} />);
    const text = screen.getByText('3');
    expect(text.props.maxFontSizeMultiplier).toBe(1.3);
    // The inverse of what the stack badge used to assert. A number a person
    // has to READ is not exempt, and the body is a stadium so it grows.
    expect(text.props.allowFontScaling).not.toBe(false);
  });
});

describe('a single plan', () => {
  it('carries its category on the body, and a face only as a corner badge', () => {
    render(<PinMark kind="plan" category="bar" photoUri="https://cdn.test/a.jpg" />);
    expect(screen.UNSAFE_getAllByType(Image)).toHaveLength(1);
    // The body still says what KIND of plan it is. That is what makes a
    // guest's map, a business's map and a signed-in map one silhouette.
    const glyphs = screen.UNSAFE_getAllByType(SymbolView);
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].props.name).toEqual({
      ios: 'wineglass.fill',
      android: 'wine_bar',
      web: 'wine_bar',
    });
  });
});

describe('fill versus void', () => {
  function bodyStyle(kind: 'plan' | 'pick', props = {}) {
    const tree = render(<PinMark kind={kind} category="bar" {...props} />);
    // The body is the view that owns a borderColor and a backgroundColor.
    const views = tree.UNSAFE_root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        styleOf(node as never).borderColor != null &&
        styleOf(node as never).backgroundColor != null
    );
    return styleOf(views[views.length - 1] as never);
  }

  it('draws a plan solid amber inside a white ring', () => {
    const body = bodyStyle('plan');
    expect(body.backgroundColor).toBe(Colors.dark.highlight);
    expect(body.borderColor).toBe('#FFFFFF');
  });

  it('draws a pick as the same silhouette inverted, and never white', () => {
    const body = bodyStyle('pick');
    expect(body.backgroundColor).toBe(Colors.dark.canvas);
    // The amber ring IS the edge. A white one here would put the two
    // families back on hue, which measured 1.31:1.
    expect(body.borderColor).toBe(Colors.dark.highlight);
    const glyphs = screen.UNSAFE_getAllByType(SymbolView);
    expect(glyphs[0].props.name).toEqual({ ios: 'star.fill', android: 'star', web: 'star' });
  });

  it('dims a later plan by its fill alone, and never dims a pick', () => {
    const later = bodyStyle('plan', { later: true });
    expect(later.backgroundColor).not.toBe(Colors.dark.highlight);
    expect(later.borderColor).toBe('#FFFFFF');
    // A pick has no day of its own to be later than.
    const pick = bodyStyle('pick', { later: true });
    expect(pick.backgroundColor).toBe(Colors.dark.canvas);
  });
});

describe('the own ring', () => {
  function hasAccentRing(props: object): boolean {
    const tree = render(<PinMark kind="plan" category="bar" {...props} />);
    return tree.UNSAFE_root.findAll((node) => typeof node.type === 'string').some(
      (node) => styleOf(node as never).borderColor === Colors.dark.accent
    );
  }

  it('finds your own plan on a single marker', () => {
    expect(hasAccentRing({ own: true })).toBe(true);
  });

  it('finds it inside a venue stack too', () => {
    // The regression the old stacked marker could not even express: your own
    // plan was swallowed whole by the venue it landed in.
    expect(hasAccentRing({ own: true, count: 4 })).toBe(true);
  });

  it('is absent when the plan belongs to another traveler', () => {
    expect(hasAccentRing({})).toBe(false);
  });
});
