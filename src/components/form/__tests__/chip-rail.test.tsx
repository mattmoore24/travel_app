import { fireEvent, render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import { ScrollView, StyleSheet } from 'react-native';

import { ChipRail, type ChipOption } from '@/components/form/chip-rail';
import { Colors, Type } from '@/constants/theme';
import { between } from '@/lib/__tests__/source';

/**
 * One chip, after three.
 *
 * ChipRow (theme.tint / theme.backgroundElement, flexWrap, a vertical
 * hitSlop) and the map filter sheet's private Chip (theme.accent /
 * theme.surface, a hairline border, a fixed 34pt height) were folded into
 * this one. The aliases all resolved to the same hex, so nothing looked
 * wrong — which is what made it dangerous, and what makes these assertions
 * worth pinning rather than eyeballing.
 */

const REPO = path.join(__dirname, '..', '..', '..', '..');

const DAYS: ChipOption<'today' | 'tomorrow' | 'friday'>[] = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'friday', label: 'Friday' },
];

describe('the 44pt guarantee', () => {
  it('carries ChipRow hitSlop, which this rail never had', () => {
    // A 34pt pill plus 5 a side is the 44 every control in this app buys.
    // ChipRail had NO hitSlop before the merge, so the guarantee had to come
    // across from ChipRow rather than the other way round.
    render(<ChipRail options={DAYS} selected="today" onSelect={jest.fn()} />);
    for (const option of DAYS) {
      expect(screen.getByLabelText(option.label).props.hitSlop).toEqual({ top: 5, bottom: 5 });
    }
  });

  it('sizes the chip by padding, never by a fixed height', () => {
    // The filter sheet's chip was `height: 34`. Dynamic Type is live
    // everywhere here, so a fixed box is where a chip clips its own label.
    const code = fs.readFileSync(path.join(REPO, 'src/components/form/chip-rail.tsx'), 'utf8');
    expect(code).not.toMatch(/height:/);
    expect(code).toContain('paddingVertical: Space.sm');
  });
});

describe('choosing one', () => {
  it('reports the value and marks only that chip selected', () => {
    const onSelect = jest.fn();
    render(<ChipRail options={DAYS} selected="tomorrow" onSelect={onSelect} />);
    expect(screen.getByLabelText('Tomorrow').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Today').props.accessibilityState.selected).toBe(false);
    fireEvent.press(screen.getByLabelText('Friday'));
    expect(onSelect).toHaveBeenCalledWith('friday');
  });

  it('takes null for nothing chosen yet, so a form can start empty', () => {
    render(<ChipRail options={DAYS} selected={null} onSelect={jest.fn()} />);
    for (const option of DAYS) {
      expect(screen.getByLabelText(option.label).props.accessibilityState.selected).toBe(false);
    }
  });

  it('speaks the group as a radiogroup and draws its heading', () => {
    render(<ChipRail label="When" options={DAYS} selected="today" onSelect={jest.fn()} />);
    expect(screen.getByText('When')).toBeTruthy();
    expect(screen.getByLabelText('When').props.accessibilityRole).toBe('radiogroup');
  });
});

describe('choosing several', () => {
  it('toggles and holds more than one at a time', () => {
    const onToggle = jest.fn();
    render(<ChipRail multi options={DAYS} selected={['today', 'friday']} onToggle={onToggle} />);
    expect(screen.getByLabelText('Today').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Friday').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Tomorrow').props.accessibilityState.selected).toBe(false);
    fireEvent.press(screen.getByLabelText('Tomorrow'));
    expect(onToggle).toHaveBeenCalledWith('tomorrow');
  });

  it('cannot be given a heading at all, because a multi rail is not a radiogroup', () => {
    // `label` used to sit on the common half of the union and the component
    // stripped the radiogroup role back off when `multi` was set. Nothing in
    // the app ever passed both - the two multi rails (rate-place's tags and
    // the filter sheet's categories) both draw their own heading - so the
    // branch was exercised only by the test asserting the branch existed.
    // The prop now lives on the single-select half, which makes the role
    // unconditional and true, and makes the pairing a compile error rather
    // than a runtime special case.
    const code = fs.readFileSync(path.join(REPO, 'src/components/form/chip-rail.tsx'), 'utf8');
    const common = between(code, 'type ChipRailCommon', 'type ChipRailSingle');
    const single = between(code, 'type ChipRailSingle', 'type ChipRailMulti');
    const multi = between(code, 'type ChipRailMulti', 'export type ChipRailProps');
    expect(common).not.toContain('label?: string');
    expect(single).toContain('label?: string');
    expect(multi).not.toContain('label');
    expect(code).toContain(`accessibilityRole="radiogroup"`);
    expect(code).not.toContain(`props.multi ? undefined : 'radiogroup'`);
  });
});

// The merge kept the filter chip's testID and dropped its border. An
// unselected chip is surfaceSunken (#20243D), which measures 1.12:1 against
// the sheet it sits in (#171A2E) and 1.24:1 against the canvas (#0E1020) - so
// without the hairline it is a word floating in the page with no pill around
// it. Both halves of that chip's look are pinned below.
describe('the shape a chip has when nobody has ticked it', () => {
  // The style sits on PressableScale's INNER Animated.View, not on the
  // Pressable: transforms participate in hit-testing, so the scale has to
  // live below the static hit rect (components/ui/pressable-scale).
  const chipStyle = (label: string): Record<string, unknown> => {
    const inner = screen.getByLabelText(label).children[0];
    if (typeof inner === 'string') {
      throw new Error(`chip "${label}" has no inner view`);
    }
    return StyleSheet.flatten(inner.props.style as never) as unknown as Record<string, unknown>;
  };

  it('draws a hairline edge, and hides it rather than removing it when selected', () => {
    const theme = Colors.dark;
    render(<ChipRail options={DAYS} selected="today" onSelect={jest.fn()} />);
    expect(chipStyle('Tomorrow').borderWidth).toBe(1);
    expect(chipStyle('Tomorrow').borderColor).toBe(theme.hairline);
    // Transparent, not absent: a chip must not move by two points when it is
    // ticked.
    expect(chipStyle('Today').borderWidth).toBe(1);
    expect(chipStyle('Today').borderColor).toBe('transparent');
  });

  it('says "on" with weight as well as with colour', () => {
    render(<ChipRail options={DAYS} selected="today" onSelect={jest.fn()} />);
    expect(StyleSheet.flatten(screen.getByText('Today').props.style)).toMatchObject({
      fontWeight: '700',
      color: Colors.dark.onAccent,
    });
    expect(StyleSheet.flatten(screen.getByText('Tomorrow').props.style)).toMatchObject({
      fontWeight: Type.footnote.fontWeight,
    });
  });
});

describe('the two arrangements', () => {
  it('scrolls sideways by default — a wrapped grid ruins a sheet with a keyboard', () => {
    render(<ChipRail options={DAYS} selected="today" onSelect={jest.fn()} />);
    expect(screen.UNSAFE_getAllByType(ScrollView).length).toBe(1);
  });

  it('wraps with no scroller at all when asked to', () => {
    render(<ChipRail wrap options={DAYS} selected="today" onSelect={jest.fn()} />);
    expect(screen.UNSAFE_queryAllByType(ScrollView).length).toBe(0);
    expect(screen.getByText('Friday')).toBeTruthy();
  });
});

describe('the handles the simulator suite holds these by', () => {
  it('passes a per-option testID straight through', () => {
    // Run 72 failed because a category chip's label led with an emoji and a
    // full-string match could not hit it. The id is the only handle on such
    // a chip and it has to survive every refactor of this component.
    render(
      <ChipRail
        multi
        options={[{ value: 'bar', label: 'Bar', testID: 'filter-category-bar' }]}
        selected={[]}
        onToggle={jest.fn()}
      />
    );
    expect(screen.getByTestId('filter-category-bar').props.accessibilityLabel).toBe('Bar');
  });
});

describe('one chip, not three', () => {
  it('leaves nothing importing the deleted ChipRow', () => {
    expect(fs.existsSync(path.join(REPO, 'src/components/form/chip-row.tsx'))).toBe(false);
    const sources = ['src/app', 'src/components', 'src/features']
      .flatMap((dir) => walk(path.join(REPO, dir)))
      .filter((file) => /\.tsx?$/.test(file) && !file.includes('__tests__'));
    for (const file of sources) {
      expect(fs.readFileSync(file, 'utf8')).not.toContain('form/chip-row');
    }
  });
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
