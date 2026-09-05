import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Segmented } from '@/components/ui/segmented';
import { HitTarget, Radius, Spacing } from '@/constants/theme';
import {
  addDays,
  formatDateRange,
  rangeForRoughDates,
  toISODate,
  validateTripRange,
} from '@/features/trips/dates';
import { RoughDatesPicker, defaultRoughDates, type RoughDates } from '@/features/trips/rough-dates';
import { TripCalendar, defaultEndFor } from '@/features/trips/trip-calendar';
import { useCitySearch, useCreateTrip } from '@/features/trips/hooks';
import type { CityRow } from '@/lib/database.types';

export default function AddTripScreen() {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<CityRow | null>(null);
  const [start, setStart] = useState(toISODate(addDays(new Date(), 7)));
  const [end, setEnd] = useState<string | null>(defaultEndFor(toISODate(addDays(new Date(), 7))));
  // "Bangkok, probably most of September" is how open-ended travel is planned,
  // and it was not expressible: the calendar wanted two taps on two specific
  // days and Post trip stayed off until both landed, so a traveler who did
  // not know either posted nothing or posted a guess and never corrected it.
  const [mode, setMode] = useState<'exact' | 'rough'>('exact');
  const [rough, setRough] = useState<RoughDates>(() => defaultRoughDates());

  const { data: suggestions = [] } = useCitySearch(city ? '' : query);
  const createTrip = useCreateTrip();

  // What actually gets written. A rough window is still a real start and a
  // real end - the widest range the traveler stands behind, under the rule in
  // rangeForRoughDates - and `approximate` is the fact that they are not a
  // claim, so everything downstream that does arithmetic on the dates is
  // unchanged.
  const approximate = mode === 'rough';
  const roughRange = rangeForRoughDates(rough.monthISO, rough.lengthDays);
  const startDate = approximate ? roughRange.start : start;
  // A half-picked range is not an error, it is a range you are still
  // picking. Continue simply stays off until the second tap lands. The rough
  // tab has no half state at all, which is the point of it.
  const endDate = approximate ? roughRange.end : end;
  const rangeError = endDate ? validateTripRange(startDate, endDate) : null;

  const submit = async () => {
    if (!city || !endDate || rangeError) {
      return;
    }
    try {
      await createTrip.mutateAsync({
        cityId: city.id,
        cityName: city.name,
        startDate,
        endDate,
        approximate,
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
      continueDisabled={!city || !endDate || rangeError != null}
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
            // The key said "return", which reads as newline on a field that
            // searches. Post trip stays grey until a city is picked, so while
            // you type there is no enabled control anywhere on screen.
            returnKeyType="search"
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
                // Spoken the way the home-city rows in
                // components/form/city-field are. This list cannot BE that
                // component - it answers with a whole CityRow, and that file's
                // header says why the two share an RPC and not a component -
                // but a suggestion carrying no role and no label is a line of
                // text to VoiceOver, and while the field is being typed in
                // these rows are the only controls on the screen.
                accessibilityRole="button"
                accessibilityLabel={`${suggestion.name}, ${suggestion.country_name}`}
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
          <Segmented
            accessibilityLabel="How well do you know your dates?"
            options={[
              { value: 'exact', label: 'Exact dates' },
              { value: 'rough', label: 'Rough dates' },
            ]}
            value={mode}
            onChange={setMode}
          />
          {approximate ? (
            <RoughDatesPicker value={rough} onChange={setRough} />
          ) : (
            <>
              <ThemedText type="smallBold">
                {end ? formatDateRange(start, end) : 'Pick the day you arrive'}
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {/* "Arrive" and "leave", the same pair the TripEditor sheet
                    uses. This screen said "leave" for the START date and the
                    sheet says it for the END one, so one word named both ends
                    of a trip depending on which screen you were on. Arriving
                    and leaving are about the city, which is what a trip is
                    about; coming back is about home, which the app never
                    asks. */}
                {end ? 'Tap any day to start again.' : 'Now tap the day you leave.'}
              </ThemedText>
              <TripCalendar
                start={start}
                end={end}
                onChange={(nextStart, nextEnd) => {
                  setStart(nextStart);
                  setEnd(nextEnd);
                }}
              />
            </>
          )}
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
  /* One city from search_cities. The floor is the point: 8pt of padding over
     a default body line is about 37pt. This is the THIRD of the app's city
     lists - the one components/form/city-field's header names as the list
     signup's hand-rolled copy claimed to match - and it was under 44 itself,
     so the claim was wrong in the other direction too. */
  suggestion: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.sm,
  },
  datesBlock: {
    gap: Spacing.two,
  },
});
