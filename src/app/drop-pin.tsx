import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { useCreatePin, useLaunchCities } from '@/features/pins/hooks';
import { LocationPicker } from '@/features/pins/location-picker';
import {
  DURATION_OPTIONS,
  PIN_CATEGORIES,
  expiryForDuration,
  intentDateOptions,
  validDurations,
  type PinDuration,
} from '@/features/pins/pin-helpers';
import { toISODate } from '@/features/trips/dates';
import type { PinCategory } from '@/lib/database.types';

const CATEGORY_OPTIONS = PIN_CATEGORIES.map((c) => ({
  value: c.value,
  label: `${c.emoji} ${c.label}`,
}));

export default function DropPinScreen() {
  const params = useLocalSearchParams<{ cityId: string }>();
  const { data: launchCities = [] } = useLaunchCities();
  const city = launchCities.find((c) => c.city_id === Number(params.cityId));
  const createPin = useCreatePin();

  const [venue, setVenue] = useState('');
  const [category, setCategory] = useState<PinCategory>('bar');
  const [intentDate, setIntentDate] = useState(toISODate(new Date()));
  const [duration, setDuration] = useState<PinDuration>('end_of_day');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  if (!city) {
    return null;
  }

  // Recomputed per render: the modal can sit open across local midnight, and
  // a stale "today" would post an already-expired pin.
  const todayISO = toISODate(new Date());
  const effectiveIntent = intentDate < todayISO ? todayISO : intentDate;
  const dateOptions = intentDateOptions();
  // Only durations that keep the pin alive into its intent day.
  const validSet = new Set(validDurations(effectiveIntent));
  const durationOptions = DURATION_OPTIONS.filter((o) => validSet.has(o.value));
  const effectiveDuration = validSet.has(duration) ? duration : 'end_of_day';

  const submit = async () => {
    if (!coords) {
      return;
    }
    try {
      await createPin.mutateAsync({
        cityId: city.city_id,
        venueName: venue.trim(),
        category,
        lat: coords.lat,
        lng: coords.lng,
        intentDate: effectiveIntent,
        expiresAt: expiryForDuration(effectiveDuration, effectiveIntent).toISOString(),
      });
      router.back();
    } catch {
      // Surfaced by the global mutation error alert (e.g. outside geofence).
    }
  };

  return (
    <StepScreen
      title={`Drop a pin in ${city.cities.name}`}
      subtitle="Future intent, venue-level — it expires on its own (72h max) and never shows where you are."
      continueLabel="Post pin"
      continueDisabled={venue.trim().length === 0 || coords == null}
      continueLoading={createPin.isPending}
      onContinue={submit}
      footer={
        coords == null ? (
          <ThemedText type="small" themeColor="textSecondary">
            Place the marker on the map to post.
          </ThemedText>
        ) : undefined
      }>
      <FormTextField
        label="Where do you want to go?"
        placeholder="Venue or spot — 'Pensão Amor', 'Arpoador sunset point'…"
        value={venue}
        onChangeText={setVenue}
      />
      <ThemedText type="smallBold">What kind of plan?</ThemedText>
      <ChipRow
        options={CATEGORY_OPTIONS}
        selected={[category]}
        onToggle={(value) => setCategory(value)}
      />
      <ThemedText type="smallBold">When?</ThemedText>
      <ChipRow
        options={dateOptions}
        selected={[effectiveIntent]}
        onToggle={(value) => setIntentDate(value)}
      />
      <ThemedText type="smallBold">Pin disappears after</ThemedText>
      <ChipRow
        options={durationOptions}
        selected={[effectiveDuration]}
        onToggle={(value) => setDuration(value)}
      />
      <LocationPicker
        centerLat={city.cities.lat}
        centerLng={city.cities.lng}
        lat={coords?.lat ?? city.cities.lat}
        lng={coords?.lng ?? city.cities.lng}
        onChange={(newLat, newLng) => setCoords({ lat: newLat, lng: newLng })}
      />
    </StepScreen>
  );
}
