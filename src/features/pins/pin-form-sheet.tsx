import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { Sheet } from '@/components/ui/sheet';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { useCreatePin } from '@/features/pins/hooks';
import {
  DURATION_OPTIONS,
  PIN_CATEGORIES,
  expiryForDuration,
  intentDateOptions,
  validDurations,
  type PinDuration,
} from '@/features/pins/pin-helpers';
import { toISODate } from '@/features/trips/dates';
import { haptics } from '@/lib/haptics';
import type { PinCategory } from '@/lib/database.types';

const CATEGORY_OPTIONS = PIN_CATEGORIES.map((c) => ({
  value: c.value,
  label: `${c.emoji} ${c.label}`,
}));

type PinFormSheetProps = {
  cityId: number;
  cityName: string;
  coords: { lat: number; lng: number };
  /** Pre-filled from the place search, if that's how the spot was found. */
  initialVenue?: string;
  onClose: () => void;
  onPosted: (pinId: string) => void;
};

/**
 * The last step of dropping a pin: the spot is already chosen on the map
 * behind this sheet — here it just gets a name, a kind, and a lifetime.
 */
export function PinFormSheet({
  cityId,
  cityName,
  coords,
  initialVenue = '',
  onClose,
  onPosted,
}: PinFormSheetProps) {
  const createPin = useCreatePin();
  const [venue, setVenue] = useState(initialVenue);
  const [note, setNote] = useState('');
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [category, setCategory] = useState<PinCategory>('bar');
  const [intentDate, setIntentDate] = useState(toISODate(new Date()));
  const [duration, setDuration] = useState<PinDuration>('end_of_day');

  // Where the map says this spot is, so the card can show a street instead
  // of a dot. Reverse-geocoding a chosen coordinate reads nobody's position.
  useEffect(() => {
    let active = true;
    Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng })
      .then((places) => {
        const place = places[0];
        if (!active || !place) {
          return;
        }
        const label = [place.name ?? place.street, place.district ?? place.city]
          .filter(Boolean)
          .join(', ');
        setPlaceLabel(label || null);
      })
      .catch(() => {
        // No label is fine; the pin still knows exactly where it is.
      });
    return () => {
      active = false;
    };
  }, [coords.lat, coords.lng]);

  // Recomputed per render: the sheet can sit open across local midnight, and
  // a stale "today" would post an already-expired pin.
  const todayISO = toISODate(new Date());
  const effectiveIntent = intentDate < todayISO ? todayISO : intentDate;
  const dateOptions = intentDateOptions();
  const validSet = new Set(validDurations(effectiveIntent));
  const durationOptions = DURATION_OPTIONS.filter((o) => validSet.has(o.value));
  const effectiveDuration = validSet.has(duration) ? duration : 'end_of_day';

  const submit = async () => {
    try {
      const pin = await createPin.mutateAsync({
        cityId,
        venueName: venue.trim(),
        note: note.trim() || null,
        placeLabel,
        category,
        lat: coords.lat,
        lng: coords.lng,
        intentDate: effectiveIntent,
        expiresAt: expiryForDuration(effectiveDuration, effectiveIntent).toISOString(),
      });
      haptics.success();
      onPosted(pin.id);
    } catch {
      // Surfaced by the global mutation error alert (e.g. outside geofence).
    }
  };

  return (
    <Sheet onClose={onClose} avoidKeyboard>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <ThemedText type="headline">What is the plan?</ThemedText>
        <FormTextField
          label="Name"
          testID="venue-input"
          placeholder="Sunset drinks, night market crawl, morning surf"
          value={venue}
          onChangeText={setVenue}
        />
        {/* The spot itself, in words, right where it was dropped. */}
        <ThemedText type="footnote" themeColor="textSecondary">
          {placeLabel ? `At ${placeLabel}` : `Where you dropped it in ${cityName}`}
        </ThemedText>
        <FormTextField
          label="Details"
          testID="note-input"
          multiline
          numberOfLines={3}
          style={styles.noteInput}
          placeholder="Meeting at the tram stop around 7, staying for one or two"
          value={note}
          onChangeText={setNote}
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
        <PrimaryButton
          label="Drop it"
          loading={createPin.isPending}
          disabled={venue.trim().length === 0}
          onPress={submit}
        />
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
          Expires on its own (72h max) and never shows where you are.
        </ThemedText>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    // Bounded so a long form scrolls inside the sheet instead of pushing it
    // up the screen.
    maxHeight: 460,
  },
  noteInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  form: {
    gap: Space.md,
  },
  note: {
    textAlign: 'center',
  },
});
