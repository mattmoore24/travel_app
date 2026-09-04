import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  /**
   * Drawn before the words. The map's category chips put the marker's own
   * glyph here, so the picker and the thing it picks share a vocabulary.
   */
  leading?: ReactNode;
  /**
   * For the simulator suite, where the visible text is not a clean handle.
   * The map's category chips carry one because a chip's label used to lead
   * with an emoji and Maestro's full-string match on "Bar" could never hit
   * it — run 72 failed on exactly that, and guest-tour.yml still selects by
   * this id.
   */
  testID?: string;
  /** Spoken in place of the label: a trip chip shows "Lisbon" and says its dates. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

type ChipRailCommon<T extends string> = {
  options: readonly ChipOption<T>[];
  /**
   * Wrap onto as many rows as it takes instead of scrolling sideways. Right
   * on a full-screen form; wrong in a sheet that also has to hold a keyboard,
   * where three rows of chips is the whole viewport.
   */
  wrap?: boolean;
};

type ChipRailSingle<T extends string> = ChipRailCommon<T> & {
  multi?: false;
  /**
   * Drawn as a heading above the chips, and spoken for the group.
   *
   * SINGLE SELECT ONLY, and that is a type rule rather than a runtime one.
   * The heading's spoken half is a `radiogroup`, which means exactly one
   * choice among the chips; a multi-select block is not that, React Native
   * has no group role that is, and the branch that used to strip the role
   * back off for `multi` had no caller in the app - only the test asserting
   * the branch existed. A labelled multi rail can come back the day
   * something needs one, with the heading it actually wants.
   */
  label?: string;
  /** `null` while nothing has been chosen yet. */
  selected: T | null;
  onSelect: (value: T) => void;
};

type ChipRailMulti<T extends string> = ChipRailCommon<T> & {
  /** Toggle semantics: any number of chips on at once, including none. */
  multi: true;
  selected: readonly T[];
  onToggle: (value: T) => void;
};

export type ChipRailProps<T extends string> = ChipRailSingle<T> | ChipRailMulti<T>;

/**
 * The app's one chip. Selectable pills, in a line that scrolls sideways or a
 * block that wraps.
 *
 * There used to be three of these on three token vocabularies — ChipRow on
 * theme.tint / theme.backgroundElement, this one on theme.accent /
 * theme.surfaceSunken, and a private Chip in the map's filter sheet on
 * theme.accent / theme.surface with a hairline border. The aliases resolve to
 * the same hex today, which is exactly what made the divergence dangerous:
 * the day tint and accent are given different values, half the chips in the
 * app change and half do not. One component, one vocabulary, one 44pt
 * guarantee.
 *
 * A merge of three things is not the intersection of them. Two of the filter
 * chip's properties are load-bearing and both are here: the hairline border,
 * which is the only shape an UNSELECTED chip has on any ground this component
 * lands on, and the bold label, which is what distinguishes "on" from
 * "differently coloured". They apply to every chip in the app now, which is
 * the point of there being one.
 */
export function ChipRail<T extends string>(props: ChipRailProps<T>) {
  const theme = useTheme();
  const { options, wrap = false } = props;
  const label = props.multi ? undefined : props.label;

  const chips = options.map((option) => {
    const active = props.multi
      ? props.selected.includes(option.value)
      : props.selected === option.value;
    return (
      <PressableScale
        key={option.value}
        testID={option.testID}
        accessibilityRole="button"
        // The words on the chip, said plainly. A chip that carries a glyph
        // would otherwise be spoken as its artwork plus its label.
        accessibilityLabel={option.accessibilityLabel ?? option.label}
        accessibilityHint={option.accessibilityHint}
        accessibilityState={{ selected: active }}
        // The haptic is PressableScale's, on the way in. Calling haptics
        // again from onPress fired it twice on every chip in the app.
        haptic="selection"
        scaleTo={0.94}
        // 36pt of chip (18 of footnote, 8 of padding a side, 1 of border)
        // plus 5 a side clears the 44 every control here buys, at the
        // default text size and by more at every larger one. This rail had
        // no hitSlop at all before the merge; the guarantee came across from
        // ChipRow rather than the other way round.
        hitSlop={{ top: 5, bottom: 5 }}
        onPress={() => {
          if (props.multi) {
            props.onToggle(option.value);
          } else {
            props.onSelect(option.value);
          }
        }}
        // The border is the SHAPE of an unselected chip, not decoration.
        // surfaceSunken on the sheet's surface measures 1.12:1 and on the
        // canvas 1.24:1 - which is to say a chip nobody has ticked is a
        // word floating in the page with no pill around it at all. The map
        // filter sheet's private Chip carried this hairline and the merge
        // dropped it; it comes back here, for every chip in the app, because
        // the fill was never doing the job on any of the grounds this
        // component lands on. Transparent rather than absent when selected,
        // so ticking a chip cannot move it by two points.
        style={[
          styles.chip,
          {
            backgroundColor: active ? theme.accent : theme.surfaceSunken,
            borderColor: active ? 'transparent' : theme.hairline,
          },
        ]}>
        {option.leading}
        {/* Bold when selected, the same way the filter sheet's chip was. The
            colour flip alone reads as "this one is a different colour"; the
            weight is what reads as "this one is on". */}
        <ThemedText
          type="footnote"
          style={active ? { color: theme.onAccent, fontWeight: '700' } : undefined}>
          {option.label}
        </ThemedText>
      </PressableScale>
    );
  });

  // No fixed height on the chip, in either arrangement: type scales with
  // Dynamic Type everywhere in this app, and a 34pt box is where a chip
  // clips its own label at the large sizes.
  const rail = wrap ? (
    <View style={styles.wrapped}>{chips}</View>
  ) : (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.row}>
      {chips}
    </ScrollView>
  );

  if (!label) {
    return rail;
  }
  // The label is drawn as well as spoken. It used to be accessibility-only,
  // AND it sat on the horizontal ScrollView, which is not a focusable
  // element — so "When" was invisible to sighted users and to VoiceOver
  // alike. The spoken half lives on the labelled wrapper below, never on the
  // scroller. The role is unconditional because `label` is a single-select
  // prop: a radiogroup is ONE choice among the chips, which is exactly what
  // a labelled rail is.
  return (
    <View style={styles.labelled} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {rail}
    </View>
  );
}

const styles = StyleSheet.create({
  labelled: {
    gap: Space.xs,
  },
  row: {
    gap: Space.sm,
    paddingRight: Space.lg,
  },
  wrapped: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    // Always present, transparent when the chip is on. The colour is set per
    // chip above; only the geometry is here, so no state change moves a chip.
    borderWidth: 1,
  },
});
