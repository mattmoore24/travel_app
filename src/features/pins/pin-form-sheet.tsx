import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ChipRail } from '@/components/form/chip-rail';
import { FormTextField } from '@/components/form/form-text-field';
import { HoursSlider } from '@/components/form/hours-slider';
import { PrimaryButton } from '@/components/form/primary-button';
import { Sheet } from '@/components/ui/sheet';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space } from '@/constants/theme';
import { useCreatePin } from '@/features/pins/hooks';
import {
  MAX_PIN_HOURS,
  categoryEmoji,
  categoryForPoi,
  defaultHoursForIntent,
  expiryForHours,
  hoursLabel,
  intentDateOptions,
  minHoursForIntent,
} from '@/features/pins/pin-helpers';
import { openInMaps } from '@/features/pins/open-in-maps';
import { toISODate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { LocalSearchResult } from '@/modules/local-search';

/** iOS toolbar id: gives the multiline field a way out of the keyboard. */
const ACCESSORY_ID = 'pin-form-done';

type PinFormSheetProps = {
  cityId: number;
  cityName: string;
  coords: { lat: number; lng: number };
  /** Everything the place search already knows, when that is how it was found. */
  initialPlace?: LocalSearchResult | null;
  onClose: () => void;
  onPosted: (pinId: string) => void;
};

/**
 * The last step of dropping a pin. The spot is already chosen on the map
 * behind this sheet; here it gets a name, a description and a lifetime.
 *
 * Two sections, because they answer different questions and the founder
 * asked for them separately: WHERE (filled in for you, with a link into
 * Maps) and WHAT (yours to write). The old "what kind of plan" row is gone
 * on purpose: when the place came from search, Apple already told us it is a
 * bar, and when it did not, the answer changes nothing anyone sees except a
 * pin emoji.
 */
export function PinFormSheet({
  cityId,
  cityName,
  coords,
  initialPlace = null,
  onClose,
  onPosted,
}: PinFormSheetProps) {
  const theme = useTheme();
  const createPin = useCreatePin();
  const [venue, setVenue] = useState(initialPlace?.name ?? '');
  const [note, setNote] = useState('');
  const [placeLabel, setPlaceLabel] = useState<string | null>(
    initialPlace ? placeLabelFor(initialPlace) : null
  );
  const [intentDate, setIntentDate] = useState(toISODate(new Date()));
  const [hours, setHours] = useState(() => defaultHoursForIntent(toISODate(new Date())));
  const [hoursTouched, setHoursTouched] = useState(false);

  const category = categoryForPoi(initialPlace?.category);

  // Where the map says this spot is, so the card can show a street instead
  // of a dot. Only when the place did not come from search, which already
  // carries an exact address. Reverse-geocoding a chosen coordinate reads
  // nobody's position.
  useEffect(() => {
    if (initialPlace) {
      return;
    }
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
  }, [coords.lat, coords.lng, initialPlace]);

  // Recomputed per render: the sheet can sit open across local midnight, and
  // a stale "today" would post an already-expired pin.
  const todayISO = toISODate(new Date());
  const effectiveIntent = intentDate < todayISO ? todayISO : intentDate;
  const minHours = minHoursForIntent(effectiveIntent);
  // Until it is dragged, the slider follows the day you pick. After that it
  // is yours, and only the floor still moves.
  const effectiveHours = hoursTouched
    ? Math.min(Math.max(hours, minHours), MAX_PIN_HOURS)
    : defaultHoursForIntent(effectiveIntent);

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
        expiresAt: expiryForHours(effectiveHours).toISOString(),
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
        // "always", not "handled": with the keyboard up, the scroll view's
        // dismiss recogniser can swallow the tap meant for another field, so
        // the text keeps going into the one that still has focus. That is
        // exactly how a plan's details ended up appended to its name.
        keyboardShouldPersistTaps="always"
        // A multiline field has no Return that closes the keyboard, which is
        // how the details box came to hide the rest of the form with no way
        // back. Dragging the list now dismisses it, and iOS gets a Done bar.
        keyboardDismissMode="interactive"
        // Left on, unlike the rest of the app's scrollers. With a keyboard up
        // this form is cut roughly in half, and the cut lands right above the
        // Drop it button, so without a bar there is nothing to say the day
        // chips and the expiry slider still exist below.
        showsVerticalScrollIndicator
        indicatorStyle="white">
        <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionLabel}>
          LOCATION
        </ThemedText>
        <View style={[styles.placeCard, { backgroundColor: theme.surfaceSunken }]}>
          <ThemedText style={styles.placeEmoji}>{categoryEmoji(category, false)}</ThemedText>
          <View style={styles.placeText}>
            <ThemedText type="callout" numberOfLines={1}>
              {initialPlace?.name ?? placeLabel ?? `Where you dropped it in ${cityName}`}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
              {[initialPlace?.address, initialPlace?.locality ?? cityName]
                .filter(Boolean)
                .join(', ')}
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="View in Maps"
            hitSlop={8}
            onPress={() =>
              openInMaps({
                lat: coords.lat,
                lng: coords.lng,
                label: initialPlace?.name ?? (venue.trim() || cityName),
              })
            }
            style={styles.mapsLink}>
            <SymbolView
              name={{ ios: 'map', android: 'map', web: 'map' }}
              size={15}
              tintColor={theme.accent}
            />
            <ThemedText type="footnote" themeColor="accent">
              View in Maps
            </ThemedText>
          </Pressable>
        </View>

        <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionLabel}>
          PLANS
        </ThemedText>
        <FormTextField
          label="What is the plan?"
          testID="venue-input"
          placeholder="Sunset drinks, night market crawl, morning surf"
          value={venue}
          onChangeText={setVenue}
          returnKeyType="done"
        />
        <FormTextField
          label="Details"
          testID="note-input"
          multiline
          numberOfLines={2}
          style={styles.noteInput}
          placeholder="Meeting at the tram stop around 7"
          value={note}
          onChangeText={setNote}
          inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
        />
        {/* A single scrolling line, not a wrapped grid: with a keyboard up
            the sheet has room for about a screen and a half of form. */}
        <ChipRail
          label="When"
          options={intentDateOptions()}
          selected={effectiveIntent}
          onSelect={setIntentDate}
        />
        <View style={styles.sliderBlock}>
          <ThemedText type="smallBold">Pin disappears after</ThemedText>
          <HoursSlider
            value={effectiveHours}
            min={minHours}
            max={MAX_PIN_HOURS}
            onChange={(next) => {
              setHoursTouched(true);
              setHours(next);
            }}
            formatValue={hoursLabel}
            accessibilityLabel="How long this pin stays up"
          />
        </View>
      </ScrollView>
      <PrimaryButton
        label="Drop it"
        loading={createPin.isPending}
        disabled={venue.trim().length === 0}
        onPress={submit}
      />
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
        Expires on its own (72h max) and never shows where you are.
      </ThemedText>

      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={ACCESSORY_ID}>
          <View style={[styles.accessory, { backgroundColor: theme.surface }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done editing"
              hitSlop={10}
              // Blurs whatever is focused without needing a ref to it.
              onPress={() => Keyboard.dismiss()}>
              <ThemedText type="smallBold" themeColor="accent">
                Done
              </ThemedText>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </Sheet>
  );
}

function placeLabelFor(place: LocalSearchResult): string | null {
  const label = [place.address, place.locality].filter(Boolean).join(', ');
  return label || null;
}

const styles = StyleSheet.create({
  scroll: {
    // Shrinks rather than overflows: the sheet is capped to the screen and
    // grows a keyboard-sized floor, so this is what gives way.
    flexShrink: 1,
  },
  noteInput: {
    minHeight: 62,
    textAlignVertical: 'top',
  },
  form: {
    gap: Space.md,
  },
  sectionLabel: {
    letterSpacing: 0.8,
  },
  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  placeEmoji: {
    fontSize: 22,
  },
  placeText: {
    flex: 1,
    gap: 2,
  },
  mapsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  sliderBlock: {
    gap: Space.xs,
  },
  note: {
    textAlign: 'center',
  },
  accessory: {
    alignItems: 'flex-end',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
});
