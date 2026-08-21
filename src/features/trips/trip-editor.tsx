import DateTimePicker from '@react-native-community/datetimepicker';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { HitTarget, NativeAppearance, Radius, Space } from '@/constants/theme';
import {
  addDays,
  formatDateRange,
  parseISODate,
  toISODate,
  validateTripRange,
} from '@/features/trips/dates';
import { useCitySearch, useCreateTrip, useDeleteTrip, useUpdateTrip } from '@/features/trips/hooks';
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
  const [start, setStart] = useState(trip ? parseISODate(trip.startDate) : addDays(new Date(), 7));
  const [end, setEnd] = useState(trip ? parseISODate(trip.endDate) : addDays(new Date(), 12));
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  const search = useCitySearch(city ? '' : query);
  const suggestions = search.data ?? [];
  const rangeError = validateTripRange(toISODate(start), toISODate(end));
  // A trip you are already on started in the past; the picker must not
  // forbid its own current value.
  const todayStart = parseISODate(toISODate(new Date()));
  const tripStart = trip ? parseISODate(trip.startDate) : todayStart;
  const minDate = tripStart < todayStart ? tripStart : todayStart;
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
          startDate: toISODate(start),
          endDate: toISODate(end),
        });
      } else {
        await createTrip.mutateAsync({
          cityId: city.id,
          cityName: city.label,
          startDate: toISODate(start),
          endDate: toISODate(end),
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

      <View style={styles.dates}>
        {(['start', 'end'] as const).map((which) => {
          const value = which === 'start' ? start : end;
          const open = picking === which;
          return (
            <PressableScale
              key={which}
              accessibilityRole="button"
              accessibilityLabel={which === 'start' ? 'Arrival date' : 'Departure date'}
              haptic="light"
              scaleTo={0.97}
              onPress={() => setPicking(open ? null : which)}
              containerStyle={styles.dateHalf}
              style={[
                styles.date,
                { backgroundColor: open ? theme.accentSoft : theme.surfaceSunken },
              ]}>
              <ThemedText type="caption" themeColor="textSecondary">
                {which === 'start' ? 'ARRIVING' : 'LEAVING'}
              </ThemedText>
              <ThemedText type="callout">
                {formatDateRange(toISODate(value), toISODate(value))}
              </ThemedText>
            </PressableScale>
          );
        })}
      </View>

      {picking ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.pickerWrap}>
          <DateTimePicker
            value={picking === 'start' ? start : end}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            minimumDate={minDate}
            accentColor={theme.accent}
            themeVariant={NativeAppearance}
            onChange={(_event, selected) => {
              if (!selected) {
                return;
              }
              if (picking === 'start') {
                setStart(selected);
                // Keep the range sane without making the user fix it.
                if (selected > end) {
                  setEnd(addDays(selected, 5));
                }
              } else {
                setEnd(selected);
              }
              if (Platform.OS !== 'ios') {
                setPicking(null);
              }
            }}
          />
        </Animated.View>
      ) : null}

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
    flexDirection: 'row',
    gap: Space.sm,
  },
  dateHalf: {
    flex: 1,
  },
  date: {
    gap: 2,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  pickerWrap: {
    alignItems: 'center',
  },
});
