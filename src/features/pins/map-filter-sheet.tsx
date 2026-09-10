import { SymbolView } from 'expo-symbols';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ChipRail, type ChipOption } from '@/components/form/chip-rail';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { LinearGradient } from 'expo-linear-gradient';

import { Radius, Space } from '@/constants/theme';
import { PlaceGlyph } from '@/features/business/business-marker';
import { useIsBusiness, useOwnBusiness } from '@/features/business/hooks';
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
import { HeatSwatch } from '@/features/pins/heat-swatch';
import { PinGlyph, PinMark } from '@/features/pins/pin-marker';
import { addDays } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { dates } from '@/lib/locale';
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
  // 'Plans', the same word the map's key uses for the same family: the sheet
  // is where that key sends people, so the two must not be different words.
  ['travelers', 'Plans', 'Plans other people have pinned.'],
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
  ownChipOnMap = false,
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
  /**
   * The owner's own chip is actually drawn right now, which is not the same
   * as being a business: a listing waiting on its email code is not in
   * city_businesses yet. The halo sentence below is only true when it is.
   */
  ownChipOnMap?: boolean;
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
  const theme = useTheme();
  // The third day has no name of its own — "later" is vague and the date is
  // noise — so it says which weekday it is, the way the pin form already
  // does. Derived from the city clock: the chip filters the city's days.
  const laterLabel = dates().weekdayLong.format(addDays(clock ?? new Date(), 2));
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

      <View style={styles.scrollFrame}>
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
          <Group
            title="What to show"
            note={viewerIsBusiness ? BUSINESS_MARKS_NOTE : TRAVELER_MARKS_NOTE}>
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
            <MarkNotes viewerIsBusiness={viewerIsBusiness} ownChipOnMap={ownChipOnMap} />
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
        {/* The chips used to be sliced through their text by the pinned
            'N plans on the map' band with no warning (run 109, screen 05a).
            The fade says the list goes on under it. */}
        <LinearGradient
          pointerEvents="none"
          colors={[`${theme.surface}00`, theme.surface]}
          style={styles.fadeBottom}
        />
      </View>

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
 * The one sentence over the four rows, and it names the AXIS the marks
 * separate on rather than their colours: filled against hollow, a chip
 * against a pin, an edge against no edge at all. Somebody who cannot tell
 * amber from gold gets nothing from a sentence about hue, and this map no
 * longer asks them to.
 */
const TRAVELER_MARKS_NOTE =
  "Four kinds of mark. A filled pin is somebody's plan, a hollow one is a spot we picked, a small ringed chip is a business, and a warm glow is where plans are clustering.";

const BUSINESS_MARKS_NOTE =
  "Four kinds of mark. A filled pin is a traveler's plan, a hollow one is a spot we picked, a small ringed chip is a business, and a warm glow is where plans are clustering.";

/**
 * What a four-word key cannot hold: the badges, the dim, and the ring around
 * your own.
 *
 * These are the sentences the two dismissible chips used to carry, and this
 * is where they live now that those are gone. Nothing shipped is lost — an
 * owner is still told what their halo is, in the one place that never
 * dismisses itself.
 */
function MarkNote({ art, children }: { art: React.ReactNode; children: string }) {
  return (
    <View style={styles.markNote} accessibilityRole="text" accessibilityLabel={children}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.markNoteArt}>
        {art}
      </View>
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.markNoteText}>
        {children}
      </ThemedText>
    </View>
  );
}

function MarkNotes({
  viewerIsBusiness,
  ownChipOnMap,
}: {
  viewerIsBusiness: boolean;
  ownChipOnMap: boolean;
}) {
  const { data: ownBusiness } = useOwnBusiness();
  return (
    <>
      <MarkNote art={<PinMark kind="plan" count={3} size={20} />}>
        A number means more than one plan at the same spot.
      </MarkNote>
      <MarkNote art={<PinMark kind="plan" open size={20} />}>
        The little pair of people means the plan is open to join.
      </MarkNote>
      <MarkNote art={<PinMark kind="plan" later size={20} />}>
        A dimmer pin is a plan for a later day. The plan list says which.
      </MarkNote>
      {viewerIsBusiness ? (
        // Only when the chip is really drawn. A sentence about a ring that is
        // not on the map is the contradiction the old chip already paid for.
        ownChipOnMap ? (
          <MarkNote
            art={
              <PlaceGlyph
                own
                onSurface
                size={20}
                live={false}
                category={ownBusiness?.category ?? 'bar'}
              />
            }>
            A blue ring means that one is your business.
          </MarkNote>
        ) : null
      ) : (
        <MarkNote art={<PinMark kind="plan" own size={20} />}>
          A blue ring means that one is yours.
        </MarkNote>
      )}
    </>
  );
}

/**
 * The artwork the map actually draws, borrowed rather than redrawn, so the
 * row and the marker cannot drift apart. Generic SF symbols said nothing the
 * map ever showed.
 *
 * The map's permanent key (map-key.tsx) sends people here, so this sheet is
 * where every mark is EXPLAINED: the key carries four words, and the four
 * sentences under MarkNotes carry the things a word cannot hold.
 */
function KindArt({ kind }: { kind: MarkerKind }) {
  switch (kind) {
    case 'travelers':
      // No category glyph: the row is about the FAMILY, and a glyph here
      // would be one category standing in for all eight.
      return <PinMark kind="plan" size={22} />;
    case 'businesses':
      // A neutral shopfront, not a wineglass: a wineglass is the glyph a bar
      // PLAN wears one row above this.
      return (
        <PlaceGlyph
          category="other"
          live={false}
          size={22}
          onSurface
          glyph={{ ios: 'storefront', android: 'storefront', web: 'storefront' }}
        />
      );
    case 'picks':
      // The star KEEPS its place: the star is what every pick shares.
      return <PinMark kind="pick" size={22} />;
    case 'heat':
      return <HeatSwatch size={22} />;
  }
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
  scrollFrame: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  fadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 24,
  },
  content: {
    gap: Space.lg,
    paddingBottom: Space.xl,
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
  markNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  markNoteArt: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markNoteText: {
    flex: 1,
  },
  filterButton: {
    // A floor, not a height: at the accessibility text sizes the word grows
    // and a fixed 30pt box sliced the bottom half off every letter and
    // spilled the trailing s onto the map (run 109, zz-ax3).
    minHeight: 30,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
});
