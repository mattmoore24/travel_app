import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { addDays, formatDateRange, toISODate, validateTripRange } from '@/features/trips/dates';
import { TripCalendar, defaultEndFor } from '@/features/trips/trip-calendar';
import { useCitySearch, useCreateTrip } from '@/features/trips/hooks';
import type { CityRow } from '@/lib/database.types';

export default function AddTripScreen() {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<CityRow | null>(null);
  const [start, setStart] = useState(toISODate(addDays(new Date(), 7)));
  const [end, setEnd] = useState<string | null>(defaultEndFor(toISODate(addDays(new Date(), 7))));

  const { data: suggestions = [] } = useCitySearch(city ? '' : query);
  const createTrip = useCreateTrip();

  // A half-picked range is not an error, it is a range you are still
  // picking. Continue simply stays off until the second tap lands.
  const rangeError = end ? validateTripRange(start, end) : null;

  const submit = async () => {
    if (!city || !end || rangeError) {
      return;
    }
    try {
      await createTrip.mutateAsync({
        cityId: city.id,
        cityName: city.name,
        startDate: start,
        endDate: end!,
      });
      router.back();
    } catch {
      // Surfaced by the global mutation error alert (e.g. trip cap reached).
    }
  };

  return (
    <StepScreen
      title="Where are you off to?"
      subtitle="City and dates only. We never track where you are."
      continueLabel="Post trip"
      continueDisabled={!city || !end || rangeError != null}
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
            placeholder="Start typing: Lisbon, Bangkok, Mexico City"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
          />
          {suggestions.map((suggestion) => {
            // Five US Springfields exist: show the admin region when a name
            // repeats within the result set.
            const duplicated =
              suggestions.filter(
                (other) =>
                  other.name === suggestion.name && other.country_code === suggestion.country_code
              ).length > 1;
            return (
              <Pressable
                key={suggestion.id}
                onPress={() => {
                  setCity(suggestion);
                  setQuery('');
                }}>
                <ThemedView type="backgroundElement" style={styles.suggestion}>
                  <ThemedText>
                    {suggestion.name}
                    <ThemedText themeColor="textSecondary">
                      {duplicated && suggestion.admin ? `, ${suggestion.admin}` : ''},{' '}
                      {suggestion.country_name}
                    </ThemedText>
                  </ThemedText>
                </ThemedView>
              </Pressable>
            );
          })}
        </>
      )}

      {city ? (
        <View style={styles.datesBlock}>
          <ThemedText type="smallBold">
            {end ? formatDateRange(start, end) : 'Pick the day you leave'}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {end ? 'Tap any day to start again.' : 'Now tap the day you come back.'}
          </ThemedText>
          <TripCalendar
            start={start}
            end={end}
            onChange={(nextStart, nextEnd) => {
              setStart(nextStart);
              setEnd(nextEnd);
            }}
          />
          {rangeError ? (
            <ThemedText type="footnote" themeColor="danger">
              {rangeError}
            </ThemedText>
          ) : null}
        </View>
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
    borderRadius: Radius.lg,
  },
  suggestion: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.sm,
  },
  datesBlock: {
    gap: Spacing.two,
  },
});
