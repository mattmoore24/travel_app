import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, parseISODate, toISODate } from '@/features/trips/dates';
import { haptics } from '@/lib/haptics';
import { PressableScale } from '@/components/ui/pressable-scale';

/**
 * Pick a trip the way a trip is actually shaped: a first day, a last day, and
 * everything in between.
 *
 * The native picker cannot do this. @react-native-community/datetimepicker is
 * a SINGLE-date control, so a range meant two separate calendars and two
 * separate taps to open them, and the days between the two were never drawn
 * at all - the one part of a trip a person is actually picturing.
 *
 * Owning the rendering also retires a whole class of bug. The native picker
 * chooses its own colours and has to be TOLD which appearance to use; miss
 * `themeVariant` on one of six call sites and it draws dark text on this
 * app's dark ground, which is exactly what the founder hit on Add a trip.
 * Nothing here can do that: every colour comes from the theme.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const CELL = 40;

type TripCalendarProps = {
  /** ISO, or null for "nothing picked yet". */
  start: string | null;
  end: string | null;
  onChange: (start: string, end: string | null) => void;
  /** Nothing before this is selectable. Defaults to today. */
  minISO?: string;
  /** How far ahead to render. */
  months?: number;
  /**
   * Scroll on its own.
   *
   * TRUE only where the calendar is the thing that has to give — a sheet with
   * a fixed button under it, which is what `flexShrink` on this scroller and
   * on its wrapper is for. Inside a page that already scrolls it must be
   * FALSE: two vertical scrollers stacked means the inner one takes every
   * drag that starts on it, and since its frame is already its whole content
   * there is nothing for it to scroll — so the page freezes, and fourteen
   * months of calendar is more than enough to fill the screen and freeze it
   * everywhere.
   */
  scroll?: boolean;
};

/** Sunday-first, matching the iOS default in the locales this launches in. */
function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = first.getDay();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(toISODate(new Date(year, month, day)));
  }
  // Pad the tail so the last row is a full week and the grid keeps its shape.
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

export function TripCalendar({
  start,
  end,
  onChange,
  minISO = toISODate(new Date()),
  months = 14,
  scroll = false,
}: TripCalendarProps) {
  const theme = useTheme();
  const today = toISODate(new Date());

  const monthsToRender = useMemo(() => {
    const from = parseISODate(minISO);
    return Array.from({ length: months }, (_, index) => {
      const cursor = new Date(from.getFullYear(), from.getMonth() + index, 1);
      return {
        key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
        label: cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        cells: monthGrid(cursor.getFullYear(), cursor.getMonth()),
      };
    });
  }, [minISO, months]);

  /**
   * One tap, three meanings, and the order is what makes it feel like one
   * gesture: with nothing picked (or a finished range behind you) a tap
   * starts a new trip; with only a start, a later day closes the range; an
   * earlier day means you changed your mind about where it starts, which is
   * far more likely than wanting an inverted range.
   */
  const pick = (day: string) => {
    haptics.selection();
    if (!start || end || day < start) {
      onChange(day, null);
      return;
    }
    onChange(start, day);
  };

  const body = (
    <>
      <View style={styles.weekdays}>
        {WEEKDAYS.map((label, index) => (
          <Text key={index} style={[styles.weekday, { color: theme.textSecondary }]}>
            {label}
          </Text>
        ))}
      </View>
      {monthsToRender.map((month) => (
        <View key={month.key} style={styles.month}>
          <ThemedText type="smallBold" style={styles.monthLabel}>
            {month.label}
          </ThemedText>
          <View style={styles.grid}>
            {month.cells.map((day, index) => {
              if (day == null) {
                return <View key={`gap-${index}`} style={styles.cell} />;
              }
              const disabled = day < minISO;
              const isStart = day === start;
              const isEnd = day === end;
              const inRange = start != null && end != null && day > start && day < end;
              // A single-day trip is both ends at once, so it keeps both caps.
              const capped = isStart || isEnd;
              return (
                <PressableScale
                  key={day}
                  accessibilityRole="button"
                  accessibilityLabel={parseISODate(day).toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                  accessibilityState={{ selected: capped || inRange, disabled }}
                  disabled={disabled}
                  scaleTo={0.9}
                  haptic="none"
                  onPress={() => pick(day)}
                  containerStyle={styles.cell}>
                  {/* The band is a sibling BEHIND the day, square-edged and
                      full-width, so consecutive days join into one continuous
                      run instead of a row of separate lozenges. The endpoints
                      round only on their outer side, which is what makes the
                      run read as having a beginning and an end. */}
                  <View
                    style={[
                      styles.band,
                      (inRange || (capped && start !== end && end != null)) && {
                        backgroundColor: theme.accentSoft,
                      },
                      isStart && end != null && styles.bandStart,
                      isEnd && styles.bandEnd,
                    ]}
                  />
                  <View style={[styles.day, capped && { backgroundColor: theme.accent }]}>
                    <Text
                      style={[
                        styles.dayText,
                        {
                          color: disabled
                            ? theme.textTertiary
                            : capped
                              ? theme.onAccent
                              : theme.text,
                        },
                        day === today && !capped && { color: theme.accent },
                      ]}>
                      {parseISODate(day).getDate()}
                    </Text>
                  </View>
                </PressableScale>
              );
            })}
          </View>
        </View>
      ))}
      {/* Room to scroll the last month clear of a docked button. */}
      <View style={styles.tail} />
    </>
  );

  return scroll ? (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {body}
    </ScrollView>
  ) : (
    <View style={styles.content}>{body}</View>
  );
}

/** The next day after `iso`, as the natural default end of a fresh trip. */
export function defaultEndFor(iso: string, nights = 4): string {
  return toISODate(addDays(parseISODate(iso), nights));
}

const styles = StyleSheet.create({
  scroll: {
    // Never taller than its content, and free to be shorter than it when the
    // sheet around it runs out of screen. Without the shrink the sheet's
    // maxHeight has nothing to give and the button below lands off-screen.
    flexGrow: 0,
    flexShrink: 1,
  },
  content: {
    gap: Space.lg,
  },
  weekdays: {
    flexDirection: 'row',
  },
  weekday: {
    ...Type.caption,
    flex: 1,
    textAlign: 'center',
  },
  month: {
    gap: Space.sm,
  },
  monthLabel: {
    paddingLeft: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    height: CELL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 3,
    bottom: 3,
  },
  bandStart: {
    borderTopLeftRadius: CELL,
    borderBottomLeftRadius: CELL,
  },
  bandEnd: {
    borderTopRightRadius: CELL,
    borderBottomRightRadius: CELL,
  },
  day: {
    width: CELL - 6,
    height: CELL - 6,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: {
    ...Type.callout,
  },
  tail: {
    height: Space.xl,
  },
});
