import { StyleSheet, View } from 'react-native';

import { ChipRail } from '@/components/form/chip-rail';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import {
  addDays,
  formatMonth,
  formatTripDates,
  parseISODate,
  rangeForRoughDates,
  toISODate,
} from '@/features/trips/dates';

/**
 * What a traveler without dates actually knows. The stored trip is still a
 * real start and a real end (`rangeForRoughDates` turns this into one); these
 * two numbers are the input to that rule, not a second copy of the dates.
 */
export type RoughDates = { monthISO: string; lengthDays: number };

/**
 * How long, in the words people use. The values feed `rangeForRoughDates`,
 * where anything that fits inside the month leaves the window at the month -
 * so the short options all read "Around Sep 1 – 30" and only a stay that
 * outruns the month pushes the far edge out. That is the rule, not a bug:
 * the month is what was picked, and the length is what stops a three-month
 * run through Asia being posted as September.
 */
const LENGTHS: readonly { value: string; label: string }[] = [
  { value: '4', label: 'A few days' },
  { value: '7', label: 'About a week' },
  { value: '14', label: 'About two weeks' },
  { value: '30', label: 'About a month' },
  { value: '60', label: 'About two months' },
  { value: '90', label: 'About three months' },
];

/** "2026-09-14" -> "2026-09". */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Twelve months starting with the one we are in. Not "from next month": a
 * traveler deciding in the middle of September that they are around for the
 * rest of it is exactly the person this tab exists for, and the table's own
 * date trigger only refuses a window that has entirely finished.
 */
export function roughMonthOptions(from: Date = new Date()): { value: string; label: string }[] {
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(from.getFullYear(), from.getMonth() + index, 1);
    const value = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
    // Asked of features/trips/dates, which owns every date string this
    // feature prints. A new file building its own Intl formatter is the
    // second engine src/lib/__tests__/one-clock.test.ts exists to refuse.
    return { value, label: formatMonth(value) };
  });
}

/**
 * The months to put on the rail for a window that may already sit outside
 * them.
 *
 * A stored rough month can be in the PAST - "two months from August", opened
 * in September by the traveler who is still on it - and `roughMonthOptions`
 * starts at the month we are in, so that month is on no chip. The rail used
 * to fall back to highlighting its first option, which made it say September
 * while the sentence above it and the dates about to be saved both said
 * August. A control that reports a value nobody chose is worse than one that
 * offers an odd choice, so the value's own month joins the list, in order.
 */
export function roughMonthOptionsFor(
  monthISO: string,
  from: Date = new Date()
): { value: string; label: string }[] {
  const months = roughMonthOptions(from);
  if (months.some((option) => option.value === monthISO)) {
    return months;
  }
  return [...months, { value: monthISO, label: formatMonth(monthISO) }].sort((a, b) =>
    a.value < b.value ? -1 : 1
  );
}

/**
 * The length chip that reproduces a window already in the database.
 *
 * The LARGEST option that still fits the stored span, never the nearest one.
 * A rough February window is 28 days; snapping that to "about a month" (30)
 * would re-derive Feb 1 to Mar 2 and quietly extend somebody's trip by two
 * days every time they opened the editor and saved. Fitting downwards is
 * idempotent for every month.
 */
export function roughLengthFor(startISO: string, endISO: string): number {
  const span =
    Math.round((parseISODate(endISO).getTime() - parseISODate(startISO).getTime()) / 86_400_000) +
    1;
  const fits = LENGTHS.map((option) => Number(option.value)).filter((days) => days <= span);
  return fits.length > 0 ? Math.max(...fits) : Number(LENGTHS[0].value);
}

/** The rough window a trip already in the database was posted with. */
export function roughDatesFor(startISO: string, endISO: string): RoughDates {
  return { monthISO: monthOf(startISO), lengthDays: roughLengthFor(startISO, endISO) };
}

/**
 * Somewhere to start when the tab is opened on a trip that has exact dates.
 *
 * NEVER a month that has already finished, even when the trip's own start
 * date is in one. A trip that began last month is the one most likely to be
 * edited - it is the one happening - and seeding its start month here handed
 * the tab a window that ended before today, which `validateTripRange` refuses
 * and Save is disabled on. This is a SEED for a guess somebody has not made
 * yet, not a stored window being reproduced (`roughDatesFor` does that, and
 * clamps nothing), so the month we are in is the honest floor: a rough claim
 * about a month that is over is not a claim anybody can act on.
 */
export function defaultRoughDates(startISO?: string): RoughDates {
  const seed = monthOf(startISO ?? toISODate(addDays(new Date(), 7)));
  const thisMonth = monthOf(toISODate(new Date()));
  return { monthISO: seed < thisMonth ? thisMonth : seed, lengthDays: 7 };
}

/**
 * "Bangkok, probably most of September", as two taps.
 *
 * One component for both writers - src/app/add-trip.tsx and the TripEditor
 * sheet - because two pickers that each decide what a rough month means is
 * the drift this package exists to prevent.
 */
export function RoughDatesPicker({
  value,
  onChange,
}: {
  value: RoughDates;
  onChange: (value: RoughDates) => void;
}) {
  const range = rangeForRoughDates(value.monthISO, value.lengthDays);
  const months = roughMonthOptionsFor(value.monthISO);
  return (
    <View style={styles.block}>
      <ThemedText type="smallBold">{formatTripDates(range.start, range.end, true)}</ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        Your profile shows the whole window, so nobody reads a guess as a plan.
      </ThemedText>
      <ChipRail
        label="Month"
        options={months}
        // The value itself, always. `roughMonthOptionsFor` is what guarantees
        // there is a chip for it; a fallback here would be the rail reporting
        // a month the header line above it does not agree with.
        selected={value.monthISO}
        onSelect={(monthISO) => onChange({ ...value, monthISO })}
      />
      <ChipRail
        label="How long"
        options={LENGTHS}
        selected={String(value.lengthDays)}
        onSelect={(days) => onChange({ ...value, lengthDays: Number(days) })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Space.sm,
  },
});
