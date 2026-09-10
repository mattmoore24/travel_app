import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Sheet } from '@/components/ui/sheet';
import { Space } from '@/constants/theme';
import { TripCalendar } from '@/features/trips/trip-calendar';

/**
 * The shared calendar, in a sheet of its own.
 *
 * Two surfaces pick a day (or a run of days) from inside something that
 * already scrolls: the pin form's When and Comes down rows, and the map
 * filter's Pick dates row. Neither can hold a month grid inline. The pin form
 * is capped and its scroller is about two rows tall with a keyboard up, so
 * an inline grid reproduces the below-the-fold regression photographed in
 * runs 76 and 121; and a calendar that scrolls inside a page that scrolls
 * freezes both (trip-calendar.tsx's own doc on `scroll`). So the calendar
 * goes in a second Sheet, where it is the one thing that has to give:
 * `scroll` is TRUE here and only here.
 *
 * No `scrolls` on the Sheet, deliberately. The calendar owns the one
 * scroller, its `flexShrink` is what gives way under the sheet's height
 * cap, and the Done button sits after it as a plain sibling so it is never
 * reachable only by scrolling. `footer` is not used because a Sheet renders
 * it only in its `scrolls` arm (components/form/__tests__/keyboard-covers-
 * the-footer). Nothing here types, so there is no keyboard to avoid.
 *
 * Rendered INSIDE the sheet that opens it, never as its sibling: a Modal
 * presents from the nearest view controller, and a Modal sitting beside an
 * already-presented one is the presentation iOS silently drops (traps).
 */
export function CalendarSheet({
  title,
  start,
  end,
  minISO,
  maxISO,
  onChange,
  onClose,
}: {
  title: string;
  start: string | null;
  end: string | null;
  minISO: string;
  maxISO: string;
  onChange: (start: string, end: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose}>
      <View style={styles.header}>
        <ThemedText type="headline" accessibilityRole="header">
          {title}
        </ThemedText>
      </View>
      {/* Thirteen months from the floor reaches a ceiling a year out; the
          calendar itself drops any month entirely past maxISO. */}
      <TripCalendar
        start={start}
        end={end}
        minISO={minISO}
        maxISO={maxISO}
        months={13}
        scroll
        onChange={onChange}
      />
      <PrimaryButton label="Done" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: Space.xs,
  },
});
