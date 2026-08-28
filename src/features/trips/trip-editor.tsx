import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { addDays, formatDateRange, toISODate, validateTripRange } from '@/features/trips/dates';
import { useCitySearch, useCreateTrip, useDeleteTrip, useUpdateTrip } from '@/features/trips/hooks';
import { TripCalendar, defaultEndFor } from '@/features/trips/trip-calendar';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { CityRow } from '@/lib/database.types';

export type EditableTrip = {
  id: string;
  cityId: number;
  cityLabel: string;
  startDate: string;
  endDate: string;
};

/**
 * Add or change a trip without leaving the profile it belongs to. Trips are
 * the thing other travelers actually read, so editing them is a sheet over
 * your own profile rather than a page you navigate away to.
 */
export function TripEditor({
  trip,
  onClose,
}: {
  /** null adds a new trip; a value edits that one. */
  trip: EditableTrip | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const createTrip = useCreateTrip();
  const updateTrip = useUpdateTrip();
  const deleteTrip = useDeleteTrip();

  const [query, setQuery] = useState('');
  const [city, setCity] = useState<{ id: number; label: string } | null>(
    trip ? { id: trip.cityId, label: trip.cityLabel } : null
  );
  const [start, setStart] = useState(trip ? trip.startDate : toISODate(addDays(new Date(), 7)));
  const [end, setEnd] = useState<string | null>(
    trip ? trip.endDate : defaultEndFor(toISODate(addDays(new Date(), 7)))
  );

  const search = useCitySearch(city ? '' : query);
  const suggestions = search.data ?? [];
  // Half a range is not an error, it is a range still being picked.
  const rangeError = end ? validateTripRange(start, end) : null;
  // A trip you are already on started in the past; the picker must not
  // forbid its own current value.
  const todayISO = toISODate(new Date());
  const minISO = trip && trip.startDate < todayISO ? trip.startDate : todayISO;
  const busy = createTrip.isPending || updateTrip.isPending || deleteTrip.isPending;

  const pickCity = (row: CityRow) => {
    haptics.selection();
    setCity({ id: row.id, label: `${row.name}, ${row.country_name}` });
    setQuery('');
  };

  const save = async () => {
    if (!city || rangeError) {
      return;
    }
    try {
      if (trip) {
        await updateTrip.mutateAsync({
          tripId: trip.id,
          cityId: city.id,
          startDate: start,
          endDate: end!,
        });
      } else {
        await createTrip.mutateAsync({
          cityId: city.id,
          cityName: city.label,
          startDate: start,
          endDate: end!,
        });
      }
      haptics.success();
      onClose();
    } catch {
      // Surfaced by the global mutation error alert; keep the sheet open.
    }
  };

  const remove = () => {
    if (!trip) {
      return;
    }
    // Every other destructive action in the app asks first; deleting travel
    // plans that other people can see should too.
    Alert.alert(
      `Delete your trip to ${trip.cityLabel}?`,
      'It disappears from your profile and from other travelers.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTrip.mutateAsync(trip.id);
              haptics.success();
              onClose();
            } catch {
              // Surfaced by the global mutation error alert.
            }
          },
        },
      ]
    );
  };

  return (
    <Sheet onClose={onClose} avoidKeyboard>
      <ThemedText type="headline">{trip ? 'Edit this trip' : 'Add a trip'}</ThemedText>

      {city ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Change city, currently ${city.label}`}
          haptic="light"
          scaleTo={0.985}
          onPress={() => setCity(null)}
          style={[styles.row, { backgroundColor: theme.accentSoft }]}>
          <SymbolView
            name={{ ios: 'mappin.and.ellipse', android: 'place', web: 'place' }}
            size={16}
            tintColor={theme.accent}
          />
          <ThemedText style={styles.rowText}>{city.label}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Change
          </ThemedText>
        </PressableScale>
      ) : (
        <View style={styles.block}>
          <FormTextField
            label="City"
            testID="city-search-input"
            autoFocus
            placeholder="Lisbon, Bangkok, Mexico City"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
          />
          {search.isError ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              Could not search right now. Check your connection and type again.
            </ThemedText>
          ) : null}
          {search.isSuccess && query.trim().length > 0 && suggestions.length === 0 ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              Nothing called that. Try the country too, like Lisbon Portugal.
            </ThemedText>
          ) : null}
          {suggestions.slice(0, 5).map((row) => (
            <PressableScale
              key={row.id}
              accessibilityRole="button"
              haptic="selection"
              scaleTo={0.985}
              onPress={() => pickCity(row)}
              style={[styles.row, { backgroundColor: theme.surfaceSunken }]}>
              <ThemedText style={styles.rowText}>
                {row.name}
                <ThemedText themeColor="textSecondary">, {row.country_name}</ThemedText>
              </ThemedText>
            </PressableScale>
          ))}
        </View>
      )}

      {/* One calendar, one gesture: tap the day you arrive, then the day you
          leave, and everything between fills in. Two separate single-date
          pickers could not draw the days in between at all - the part of a
          trip a person is actually picturing. */}
      <View style={styles.dates}>
        <ThemedText type="smallBold">
          {end ? formatDateRange(start, end) : 'Pick the day you arrive'}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {end ? 'Tap any day to start again.' : 'Now tap the day you leave.'}
        </ThemedText>
        <TripCalendar
          scroll
          start={start}
          end={end}
          minISO={minISO}
          onChange={(nextStart, nextEnd) => {
            setStart(nextStart);
            setEnd(nextEnd);
          }}
        />
      </View>

      {rangeError ? (
        <ThemedText type="footnote" style={{ color: theme.danger }}>
          {rangeError}
        </ThemedText>
      ) : null}

      <PrimaryButton
        label={trip ? 'Save changes' : 'Add trip'}
        testID="save-trip"
        disabled={!city || rangeError != null || busy}
        loading={busy}
        onPress={save}
      />
      {trip ? <PrimaryButton variant="danger" label="Delete this trip" onPress={remove} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: HitTarget,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  rowText: {
    flex: 1,
  },
  dates: {
    gap: Space.xs,
    // The sheet is capped to the screen and its buttons sit under this block,
    // so this is the one part that gives way. Without it fourteen months of
    // calendar laid out at full height and pushed "Add trip" clean off the
    // bottom edge, with no scroller anywhere to reach it.
    flexShrink: 1,
  },
});
