import { SymbolView } from 'expo-symbols';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ChipRail, type ChipOption } from '@/components/form/chip-rail';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Space } from '@/constants/theme';
import { PlaceGlyph } from '@/features/business/business-marker';
import { useIsBusiness } from '@/features/business/hooks';
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
import { PinGlyph } from '@/features/pins/pin-marker';
import { addDays } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { countOf } from '@/lib/plural';

/**
 * The families of marker, as each kind of account is asked about them.
 *
 * A traveler is choosing who to meet, so the wording is about people and
 * their plans. A business is choosing what its own map shows, and its feed
 * of traveler pins carries no names, ages or faces at all (see
 * features/guest/hooks) — so the row says so rather than implying a
 * directory that is not there.
 */
const TRAVELER_KINDS: [MarkerKind, string, string][] = [
  ['travelers', 'Travelers', 'Plans other people have pinned.'],
  ['businesses', 'Businesses', 'Bars, hostels and cafes with a page here.'],
  ['picks', 'Samewhere picks', 'Spots we put on the map ourselves.'],
  // Visible even when the layer is empty — which is exactly when somebody
  // needs to know the layer exists at all. The subtitle is the rule 6
  // promise in a sentence.
  [
    'heat',
    'Busy areas',
    "Where plans are clustering. Never shown unless enough people are in on it, and never anyone's name.",
  ],
];

const BUSINESS_KINDS: [MarkerKind, string, string][] = [
  ['travelers', 'Traveler plans', 'Where people are heading. No names, no faces.'],
  [
    'businesses',
    'Businesses',
    // Not "yours included": city_businesses only carries listings that are
    // active and listed, so an owner waiting on their email code has no chip
    // at all, and this row would have promised them one and sent them hunting
    // for it. The legend teaches the ring only when the ring is drawn; this
    // says nothing it cannot keep either.
    'Every business that is live on the map.',
  ],
  ['picks', 'Samewhere picks', 'Spots we put on the map ourselves.'],
  [
    'heat',
    'Busy areas',
    "Where plans are clustering. Never shown unless enough people are in on it, and never anyone's name.",
  ],
];

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
  resultCount,
  totalCount,
  clock,
  onChange,
  onClose,
}: {
  filters: MapFilters;
  /**
   * The browsed city's wall clock (cityClockNow). The third day chip is
   * named for a weekday, and the weekday two days out is the CITY's, not the
   * reader's — fifteen hours of difference can make it the wrong name.
   */
  clock?: Date;
  /**
   * How many markers survive right now — computed by the map from the SAME
   * arrays the markers render (see mapResultCount), or the number would
   * contradict the dots.
   */
  resultCount: number;
  /** Everything the city has before the filters, for '3 of 11 plans'. */
  totalCount: number;
  onChange: (next: MapFilters) => void;
  onClose: () => void;
}) {
  // The other two groups are traveler-discovery controls. "When" answers
  // "which day am I meeting somebody", and "Kind of plan" narrows other
  // people's evenings by category — a business is doing neither, and the
  // founder's words are that the map "as a business isn't used for that
  // purpose". What is left is the one question an owner does have: what is
  // drawn on my map.
  const viewerIsBusiness = useIsBusiness();
  // The third day has no name of its own — "later" is vague and the date is
  // noise — so it says which weekday it is, the way the pin form already
  // does. Derived from the city clock: the chip filters the city's days.
  const laterLabel = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(
    addDays(clock ?? new Date(), 2)
  );
  const dayOptions: ChipOption<DayFilter>[] = [
    { value: 'any', label: 'Any day' },
    { value: 'today', label: 'Today' },
    { value: 'tomorrow', label: 'Tomorrow' },
    { value: 'later', label: laterLabel },
  ];
  // The cap is what keeps a strip of MAP visible above the sheet: the whole
  // argument against an Apply button is that you watch the markers answer
  // every tick, and the un-capped sheet ran to the tab bar and covered the
  // map it claimed to be updating live.
  const { height } = useWindowDimensions();

  return (
    <Sheet inline dimmed={false} onClose={onClose}>
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <ThemedText type="headline" accessibilityRole="header">
            Filters
          </ThemedText>
          {/* The size of what was removed, legible at a glance — only when
              there was anything to remove. '0 of 0 plans' over an empty city
              reads as a filter problem the sheet cannot fix. */}
          {totalCount > 0 ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {resultCount} of {countOf(totalCount, 'plan')}
            </ThemedText>
          ) : null}
        </View>
        {/* Only when there is something to clear. A permanently visible
            "Clear all" over a map with nothing filtered is a button that
            implies the map is hiding something. */}
        {isDefault(filters) ? null : (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            haptic="light"
            scaleTo={0.94}
            // 13, not 8. An 18pt footnote row plus 13 a side is the 44 this
            // app buys every small control; 8 made it 34, which is smaller
            // than every chip in the sheet below it and is the one control
            // here that undoes everything the sheet did. Same arithmetic the
            // place sheet's close button and "See the whole page" link use.
            hitSlop={13}
            onPress={() => onChange(DEFAULT_FILTERS)}>
            <ThemedText type="footnote" themeColor="accent">
              Clear all
            </ThemedText>
          </PressableScale>
        )}
      </View>

      <ScrollView
        style={[styles.scroll, { maxHeight: height * 0.6 }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {/* No note. Four chips ending on a weekday two days out say the
            three-day horizon better than a sentence about it does, and the
            four groups only fit on a small phone without one. */}
        {viewerIsBusiness ? null : (
          <Group title="When">
            {/* No `label` on the rail: Group already draws the heading, and
                two of them would be the same word twice. */}
            <ChipRail
              wrap
              options={dayOptions}
              selected={filters.day}
              onSelect={(day) => onChange({ ...filters, day })}
            />
          </Group>
        )}

        {/* The one-stays rule is enforced rather than explained: unticking
            the last box simply does not take, which is how every filter list
            people already use behaves. */}
        <Group title="What to show">
          {(viewerIsBusiness ? BUSINESS_KINDS : TRAVELER_KINDS).map(([value, title, detail]) => (
            <CheckRow
              key={value}
              title={title}
              detail={detail}
              leading={<KindArt kind={value} />}
              checked={filters.kinds.includes(value)}
              onPress={() => onChange({ ...filters, kinds: toggle(filters.kinds, value, true) })}
            />
          ))}
        </Group>

        {viewerIsBusiness ? null : (
          <Group
            title="Kind of plan"
            note={
              filters.categories.length === 0
                ? 'Nothing ticked means everything.'
                : "Only travelers' plans. Businesses are filtered above."
            }>
            {/* The marker's own disc and glyph, so the picker and the thing
                it picks share a vocabulary. Emoji here contradicted the map
                twice (Museum, Sights) and put a red pushpin on screen.

                The testID is what the simulator suite holds these by: a
                category chip's label used to lead with an emoji, so Maestro's
                full-string match on "Bar" could never hit it — run 72 failed
                on exactly that, and guest-tour.yml still selects by this id. */}
            <ChipRail
              wrap
              multi
              options={PIN_CATEGORIES.map((category) => ({
                value: category.value,
                label: category.label,
                leading: <PinGlyph category={category.value} size={18} />,
                testID: `filter-category-${category.value}`,
              }))}
              selected={filters.categories}
              onToggle={(value) =>
                onChange({ ...filters, categories: toggle(filters.categories, value) })
              }
            />
          </Group>
        )}
      </ScrollView>

      {/* What survived, said in words right above the exit — the map has
          already applied everything, and an over-filtered map must never be
          mistakable for an empty city. Only when the FILTERS did the
          emptying, though (the header's own Clear all uses the same test): a
          genuinely empty city at the defaults has nothing filtered out and
          nothing to clear, so it gets the honest sentence instead. */}
      {resultCount === 0 && !isDefault(filters) ? (
        <View style={styles.resultEmpty}>
          <ThemedText type="smallBold" style={styles.resultLine}>
            No plans fit these filters
          </ThemedText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            haptic="light"
            scaleTo={0.94}
            // The same 44 as the header's Clear all above, and for the same
            // reason: it is the same control, offered a second time to
            // somebody who has just filtered the map down to nothing.
            hitSlop={13}
            onPress={() => onChange(DEFAULT_FILTERS)}>
            <ThemedText type="footnote" themeColor="accent" style={styles.resultLine}>
              Clear all
            </ThemedText>
          </PressableScale>
        </View>
      ) : resultCount === 0 ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.resultLine}>
          Nothing on the map yet.
        </ThemedText>
      ) : (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.resultLine}>
          {countOf(resultCount, 'plan')} on the map
        </ThemedText>
      )}
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

/**
 * The artwork the map actually draws, so these rows double as the map's
 * permanent legend — the one-shot chips can be dismissed forever, and this
 * sheet is where a person can always come back to be told what the marker
 * families are. Generic SF symbols said nothing the map ever showed.
 */
function KindArt({ kind }: { kind: MarkerKind }) {
  switch (kind) {
    case 'travelers':
      return <PinGlyph category="other" size={22} />;
    case 'businesses':
      return <PlaceGlyph category="bar" live={false} size={22} onSurface />;
    case 'picks':
      return <PinGlyph category="other" seeded size={22} />;
    case 'heat':
      return <HeatSwatch />;
  }
}

/** The glow, as a chip-sized swatch — the heat layer has no marker to borrow. */
function HeatSwatch() {
  return (
    <View style={styles.heatSwatchWrap}>
      <View style={[styles.heatSwatch, { backgroundColor: 'rgba(255, 154, 90, 0.85)' }]} />
    </View>
  );
}

function CheckRow({
  title,
  detail,
  leading,
  checked,
  onPress,
}: {
  title: string;
  detail: string;
  /** The marker artwork this row is about. */
  leading: React.ReactNode;
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
        {leading}
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
  headerTitle: {
    gap: 2,
  },
  resultLine: {
    textAlign: 'center',
  },
  resultEmpty: {
    gap: Space.xs,
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
  // The same 22pt box the marker glyphs occupy, so the four rows line up.
  heatSwatchWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heatSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
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
