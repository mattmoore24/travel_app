import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { addDays, formatDateRange, toISODate, validateTripRange } from '@/features/trips/dates';
import { useCitySearch, useCreateTrip } from '@/features/trips/hooks';
import { useTheme } from '@/hooks/use-theme';
import type { CityRow } from '@/lib/database.types';

export default function AddTripScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<CityRow | null>(null);
  const [startDate, setStartDate] = useState(addDays(new Date(), 7));
  const [endDate, setEndDate] = useState(addDays(new Date(), 12));
  const [openPicker, setOpenPicker] = useState<'start' | 'end' | null>(
    Platform.OS === 'ios' ? 'start' : null
  );

  const { data: suggestions = [] } = useCitySearch(city ? '' : query);
  const createTrip = useCreateTrip();

  const rangeError = validateTripRange(toISODate(startDate), toISODate(endDate));

  const submit = async () => {
    if (!city || rangeError) {
      return;
    }
    try {
      await createTrip.mutateAsync({
        cityId: city.id,
        cityName: city.name,
        startDate: toISODate(startDate),
        endDate: toISODate(endDate),
      });
      router.back();
    } catch {
      // Surfaced by the global mutation error alert (e.g. trip cap reached).
    }
  };

  const dateRow = (which: 'start' | 'end', value: Date) => (
    <Pressable
      onPress={() => setOpenPicker(openPicker === which ? null : which)}
      style={styles.dateRowPress}>
      <ThemedView
        type={openPicker === which ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.dateRow}>
        <ThemedText type="smallBold">{which === 'start' ? 'From' : 'Until'}</ThemedText>
        <ThemedText>{formatDateRange(toISODate(value), toISODate(value))}</ThemedText>
      </ThemedView>
    </Pressable>
  );

  return (
    <StepScreen
      title="Add a trip"
      subtitle="City and dates only — this is future intent, never your live location."
      continueLabel="Post trip"
      continueDisabled={!city || rangeError != null}
      continueLoading={createTrip.isPending}
      onContinue={submit}>
      {city ? (
        <Pressable onPress={() => setCity(null)}>
          <ThemedView type="backgroundSelected" style={styles.cityChip}>
            <ThemedText type="smallBold">
              {city.name}, {city.country_name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              change
            </ThemedText>
          </ThemedView>
        </Pressable>
      ) : (
        <>
          <FormTextField
            label="City"
            placeholder="Start typing — Lisbon, Bangkok, Mexico City…"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
          />
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              onPress={() => {
                setCity(suggestion);
                setQuery('');
              }}>
              <ThemedView type="backgroundElement" style={styles.suggestion}>
                <ThemedText>
                  {suggestion.name}
                  <ThemedText themeColor="textSecondary">, {suggestion.country_name}</ThemedText>
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </>
      )}

      <View style={styles.datesBlock}>
        {dateRow('start', startDate)}
        {dateRow('end', endDate)}
      </View>
      {openPicker ? (
        <DateTimePicker
          value={openPicker === 'start' ? startDate : endDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={new Date()}
          accentColor={theme.tint}
          onChange={(event, selected) => {
            if (Platform.OS !== 'ios') {
              setOpenPicker(null);
            }
            if (event.type === 'dismissed' || !selected) {
              return;
            }
            if (openPicker === 'start') {
              setStartDate(selected);
              if (selected > endDate) {
                setEndDate(addDays(selected, 3));
              }
            } else {
              setEndDate(selected);
            }
          }}
        />
      ) : null}
      {rangeError ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {rangeError}
        </ThemedText>
      ) : null}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  cityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  suggestion: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  datesBlock: {
    gap: Spacing.two,
  },
  dateRowPress: {
    alignSelf: 'stretch',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
});
