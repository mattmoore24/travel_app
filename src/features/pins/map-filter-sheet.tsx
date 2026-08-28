import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Space } from '@/constants/theme';
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  isDefault,
  toggle,
  type DayFilter,
  type MapFilters,
  type MarkerKind,
} from '@/features/pins/filters';
import { PIN_CATEGORIES } from '@/features/pins/pin-helpers';
import { addDays } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';

/**
 * Everything the map can be narrowed by, in one place.
 *
 * Founder: "the all, today, tomorrow filters are confusing. You should instead
 * just add a filters icon that takes users to a different screen and select any
 * type of filter they want."
 *
 * An INLINE sheet rather than a pushed route, for two reasons. The map stays
 * live underneath, so every tick is answered by markers appearing and
 * disappearing behind the sheet — which is the whole argument against an Apply
 * button, and the reason there isn't one. And pushing a route from inside a
 * presented sheet is the bug this app has already paid for once: the route
 * goes under the scrim, the scrim survives, and the map comes back dead to
 * touch (see components/ui/sheet, `leavingSheet`).
 */
export function MapFilterSheet({
  filters,
  onChange,
  onClose,
}: {
  filters: MapFilters;
  onChange: (next: MapFilters) => void;
  onClose: () => void;
}) {
  // The third day has no name of its own — "later" is vague and the date is
  // noise — so it says which weekday it is, the way the pin form already does.
  const laterLabel = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(
    addDays(new Date(), 2)
  );

  return (
    <Sheet inline dimmed={false} onClose={onClose}>
      <View style={styles.header}>
        <ThemedText type="headline" accessibilityRole="header">
          Filters
        </ThemedText>
        {/* Only when there is something to clear. A permanently visible
            "Clear all" over a map with nothing filtered is a button that
            implies the map is hiding something. */}
        {isDefault(filters) ? null : (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            haptic="light"
            scaleTo={0.94}
            hitSlop={8}
            onPress={() => onChange(DEFAULT_FILTERS)}>
            <ThemedText type="footnote" themeColor="accent">
              Clear all
            </ThemedText>
          </PressableScale>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {/* No note. Four chips ending on a weekday two days out say the
            three-day horizon better than a sentence about it does, and the
            four groups only fit on a small phone without one. */}
        <Group title="When">
          <View style={styles.chips}>
            {(
              [
                ['any', 'Any day'],
                ['today', 'Today'],
                ['tomorrow', 'Tomorrow'],
                ['later', laterLabel],
              ] as [DayFilter, string][]
            ).map(([value, label]) => (
              <Chip
                key={value}
                label={label}
                selected={filters.day === value}
                onPress={() => onChange({ ...filters, day: value })}
              />
            ))}
          </View>
        </Group>

        {/* The one-stays rule is enforced rather than explained: unticking
            the last box simply does not take, which is how every filter list
            people already use behaves. */}
        <Group title="What to show">
          {(
            [
              [
                'travelers',
                'Travelers',
                'Plans other people have pinned.',
                { ios: 'figure.walk', android: 'hiking', web: 'hiking' },
              ],
              [
                'businesses',
                'Businesses',
                'Bars, hostels and cafes with a page here.',
                { ios: 'storefront.fill', android: 'storefront', web: 'storefront' },
              ],
              [
                'picks',
                'Samewhere picks',
                'Spots we put on the map ourselves.',
                { ios: 'star.fill', android: 'star', web: 'star' },
              ],
            ] as [MarkerKind, string, string, SymbolViewProps['name']][]
          ).map(([value, title, detail, glyph]) => (
            <CheckRow
              key={value}
              title={title}
              detail={detail}
              glyph={glyph}
              checked={filters.kinds.includes(value)}
              onPress={() => onChange({ ...filters, kinds: toggle(filters.kinds, value, true) })}
            />
          ))}
        </Group>

        <Group
          title="Kind of plan"
          note={
            filters.categories.length === 0
              ? 'Nothing ticked means everything.'
              : 'Only travelers’ plans. Businesses are filtered above.'
          }>
          <View style={styles.chips}>
            {PIN_CATEGORIES.map((category) => (
              <Chip
                key={category.value}
                testID={`filter-category-${category.value}`}
                label={`${category.emoji}  ${category.label}`}
                selected={filters.categories.includes(category.value)}
                onPress={() =>
                  onChange({
                    ...filters,
                    categories: toggle(filters.categories, category.value),
                  })
                }
              />
            ))}
          </View>
        </Group>

        <Group title="Who">
          <CheckRow
            title="Verified travelers only"
            // One short line. Two wrap, and the second was clipped by the pinned
            // Done button on run 72.
            detail="Our own picks stay either way."
            glyph={{
              ios: 'checkmark.seal.fill',
              android: 'verified',
              web: 'verified',
            }}
            checked={filters.verifiedOnly}
            onPress={() => onChange({ ...filters, verifiedOnly: !filters.verifiedOnly })}
          />
        </Group>
      </ScrollView>

      {/* "Done", not "Apply". Nothing is waiting to be applied — the map has
          been answering every tap behind this sheet the whole time — and a
          button called Apply on a screen that has already applied everything
          teaches people to distrust what they just watched happen. */}
      <PrimaryButton label="Done" onPress={onClose} />
    </Sheet>
  );
}

function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {note ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {note}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /**
   * For the simulator suite. A category chip's label leads with an emoji, so
   * Maestro's full-string match on "Bar" can never hit it — run 72 failed on
   * exactly that. An id is what the rest of the suite uses for anything whose
   * visible text is not a clean handle.
   */
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      haptic="selection"
      scaleTo={0.94}
      onPress={onPress}>
      <View
        style={[
          styles.chip,
          {
            backgroundColor: selected ? theme.accent : theme.surface,
            borderColor: selected ? 'transparent' : theme.hairline,
          },
        ]}>
        <ThemedText
          type="footnote"
          style={selected ? { color: theme.onAccent, fontWeight: '700' } : undefined}>
          {label}
        </ThemedText>
      </View>
    </PressableScale>
  );
}

function CheckRow({
  title,
  detail,
  glyph,
  checked,
  onPress,
}: {
  title: string;
  detail: string;
  glyph: SymbolViewProps['name'];
  checked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityState={{ checked }}
      haptic="selection"
      scaleTo={0.98}
      onPress={onPress}>
      <ThemedView
        type={checked ? 'accentSoft' : 'backgroundElement'}
        style={[styles.row, { borderColor: checked ? theme.accent : 'transparent' }]}>
        <SymbolView
          name={glyph}
          size={18}
          tintColor={checked ? theme.accent : theme.textSecondary}
        />
        <View style={styles.rowText}>
          <ThemedText type="smallBold">{title}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {detail}
          </ThemedText>
        </View>
        <SymbolView
          name={
            checked
              ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' }
              : {
                  ios: 'square',
                  android: 'check_box_outline_blank',
                  web: 'check_box_outline_blank',
                }
          }
          size={20}
          tintColor={checked ? theme.accent : theme.textSecondary}
        />
      </ThemedView>
    </PressableScale>
  );
}

/**
 * The one control on the map, in place of the three date chips.
 *
 * It carries a count rather than a dot: a number tells somebody why the map
 * looks emptier than they expected, and roughly how much there is to undo.
 */
export function FilterButton({ filters, onPress }: { filters: MapFilters; onPress: () => void }) {
  const theme = useTheme();
  const count = activeFilterCount(filters);
  const on = count > 0;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={on ? `Filters, ${count} on` : 'Filters'}
      accessibilityHint="Choose what the map shows"
      // Drawn at 30pt over a map that needs the room; the target is 44.
      hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
      haptic="light"
      scaleTo={0.94}
      onPress={onPress}>
      <View
        style={[
          styles.filterButton,
          {
            backgroundColor: on ? theme.accent : theme.surface,
            borderColor: on ? 'transparent' : theme.hairline,
          },
        ]}>
        <SymbolView
          name={{
            ios: 'line.3.horizontal.decrease',
            android: 'filter_list',
            web: 'filter_list',
          }}
          size={14}
          tintColor={on ? theme.onAccent : theme.text}
        />
        <ThemedText
          type="footnote"
          style={on ? { color: theme.onAccent, fontWeight: '700' } : undefined}>
          {on ? `Filters · ${count}` : 'Filters'}
        </ThemedText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  /* Grows to its content and SHRINKS when there is not room. Without the
     shrink, four groups on a small phone push Done off the bottom of a sheet
     that is already at its maximum height. */
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  content: {
    gap: Space.lg,
    paddingBottom: Space.sm,
  },
  group: {
    gap: Space.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  chip: {
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  filterButton: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
});
