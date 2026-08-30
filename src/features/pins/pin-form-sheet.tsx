import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { ChipRail } from '@/components/form/chip-rail';
import { FormTextField } from '@/components/form/form-text-field';
import { HoursSlider } from '@/components/form/hours-slider';
import { PinGlyph } from '@/features/pins/pin-marker';
import { PrimaryButton } from '@/components/form/primary-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { ThemedText } from '@/components/themed-text';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { useCreatePin } from '@/features/pins/hooks';
import {
  MAX_PIN_HOURS,
  categoryForPoi,
  defaultHoursForIntent,
  expiryForHours,
  hoursLabel,
  intentDateOptions,
  intentLabel,
  minHoursForIntent,
} from '@/features/pins/pin-helpers';
import { openInMaps } from '@/features/pins/open-in-maps';
import { toISODate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { LocalSearchResult } from '@/modules/local-search';

/** iOS toolbar id: gives the multiline field a way out of the keyboard. */
type PinFormSheetProps = {
  cityId: number;
  cityName: string;
  coords: { lat: number; lng: number };
  /** Everything the place search already knows, when that is how it was found. */
  initialPlace?: LocalSearchResult | null;
  /** The name the map's pill already resolved, so it is not fetched twice. */
  initialLabel?: string | null;
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
  initialLabel = null,
  onClose,
  onPosted,
}: PinFormSheetProps) {
  const theme = useTheme();
  const createPin = useCreatePin();
  const [venue, setVenue] = useState(initialPlace?.name ?? '');
  const [note, setNote] = useState('');
  const [placeLabel, setPlaceLabel] = useState<string | null>(
    initialPlace ? placeLabelFor(initialPlace) : initialLabel
  );
  const [intentDate, setIntentDate] = useState(toISODate(new Date()));
  const [hours, setHours] = useState(() => defaultHoursForIntent(toISODate(new Date())));
  const [hoursTouched, setHoursTouched] = useState(false);
  // Founder: some people want an open plan and some want to be asked first,
  // and neither is the odd one out. Open is the default because it is the
  // thing the app could not do before, and because a plan nobody has to
  // audition for is the reason most of these pins get dropped.
  const [joinable, setJoinable] = useState(true);

  // Where each text field sits in the scroller, and the scroller itself, so
  // focusing one can bring it above the fold. Written from onLayout and read
  // from onFocus — both events, never during render, which is also why the
  // handlers are inline rather than made by a factory the compiler would see
  // being called while rendering.
  const scrollRef = useRef<ScrollView>(null);
  const fieldY = useRef<Record<string, number>>({});

  const category = categoryForPoi(initialPlace?.category);

  // Where the map says this spot is, so the card can show a street instead
  // of a dot. Only when the place did not come from search, which already
  // carries an exact address, and only when the map's own pill never
  // resolved a name — this is the fallback, not the fast path any more.
  // Reverse-geocoding a chosen coordinate reads nobody's position.
  useEffect(() => {
    if (initialPlace || initialLabel) {
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
  }, [coords.lat, coords.lng, initialLabel, initialPlace]);

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

  // The footnote answers whichever question the button is asking right now:
  // grey, it says which box it is waiting for; live, it repeats the promise.
  // Same slot, one line either way, so nothing reflows. The expiry itself is
  // stated by the "Disappears after" heading, once, not three times.
  const needsPlan = venue.trim().length === 0;
  const footnote = needsPlan
    ? 'Say what the plan is first.'
    : 'A plan, not your location. It disappears on its own.';

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
        joinable,
      });
      haptics.success();
      onPosted(pin.id);
    } catch {
      // Surfaced by the global mutation error alert (e.g. outside geofence).
    }
  };

  return (
    <Sheet onClose={onClose} avoidKeyboard>
      {/* The fades live HERE, not in the Sheet: every other Sheet caller has
          static children, and a generic top fade would wash out their first
          row for no reason. They say "there is more" where the scroll edge
          used to slice letterforms in half with no warning at all. */}
      <View style={styles.scrollFrame}>
        <ScrollView
          ref={scrollRef}
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
            Where
          </ThemedText>
          <View style={[styles.placeCard, { backgroundColor: theme.surfaceSunken }]}>
            {/* The marker's own face, so choosing a category previews the pin
              you are about to drop rather than showing an emoji sticker. */}
            <PinGlyph category={category} />
            <View style={styles.placeText}>
              {/* Two lines. A one-line cap was set without checking it against
                real place names and truncated the very thing the person is
                being asked to confirm — "Somdet Phra Pokklao Bri…" — while
                the line under it held only the word "Bangkok". */}
              <ThemedText type="callout" numberOfLines={2}>
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

          {/* ABOVE THE FIELDS, and that is the whole point of where it sits.
            "Anyone can join" is the DEFAULT, and it does something a pin has
            never done before: it opens a group chat and lets strangers into
            it. Below the two text fields it was the last thing on a form
            whose scroller is about two rows tall with a keyboard up — run 76
            photographed it clipped in half, with the alternative entirely off
            screen. A choice somebody has to go looking for is not a choice
            they made. Here it is the first thing under the place, before any
            field has taken focus and before any keyboard exists. */}
          <View style={styles.joinBlock}>
            <ThemedText type="smallBold">How people come along</ThemedText>
            {JOIN_MODES.map((mode) => {
              const active = mode.open === joinable;
              return (
                <PressableScale
                  key={mode.label}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${mode.label}. ${mode.detail}`}
                  testID={mode.open ? 'pin-open-to-join' : 'pin-message-first'}
                  scaleTo={0.985}
                  onPress={() => {
                    if (active) {
                      return;
                    }
                    haptics.selection();
                    setJoinable(mode.open);
                  }}
                  style={[
                    styles.joinRow,
                    { backgroundColor: active ? theme.accentSoft : theme.surfaceSunken },
                  ]}>
                  <SymbolView
                    name={mode.glyph}
                    size={17}
                    tintColor={active ? theme.accent : theme.textSecondary}
                  />
                  <View style={styles.joinText}>
                    <ThemedText type="callout">{mode.label}</ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {mode.detail}
                    </ThemedText>
                  </View>
                  {active ? (
                    <SymbolView
                      name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                      size={16}
                      tintColor={theme.accent}
                    />
                  ) : null}
                </PressableScale>
              );
            })}
          </View>
          {/* THE DAY AND THE LIFETIME SIT ABOVE THE FIELDS — the same precedent
            the join block records above: these two controls are what a pin IS,
            and below the text fields they were the two things the keyboard
            hid entirely while the button stayed live. A single scrolling line
            for the days, not a wrapped grid: with a keyboard up the sheet has
            room for about a screen and a half of form. */}
          <ChipRail
            label="When"
            options={intentDateOptions()}
            selected={effectiveIntent}
            onSelect={setIntentDate}
          />
          <View
            style={styles.sliderBlock}
            onLayout={(event) => {
              fieldY.current.expiry = event.nativeEvent.layout.y;
            }}>
            {/* The value rides the heading, so it is readable even when the
              track is not in view. */}
            <ThemedText type="smallBold">
              Disappears after · {hoursLabel(effectiveHours)}
            </ThemedText>
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
          {/* BRING THE FOCUSED FIELD INTO VIEW. With the keyboard up the sheet
            reserves a keyboard's worth of floor and this scroller is what
            gives way — it ends up about two rows tall. Without this the plan
            field stays where it was, below the fold, and a simulator run
            photographed the result: the sentence being typed sliced clean
            through the middle of its own letters by the submit button. */}
          <View
            onLayout={(event) => {
              fieldY.current.venue = event.nativeEvent.layout.y;
            }}>
            <FormTextField
              label="What's the plan?"
              testID="venue-input"
              placeholder="Sunset drinks, morning surf"
              value={venue}
              onChangeText={setVenue}
              onFocus={() => {
                scrollRef.current?.scrollTo({
                  y: Math.max(0, (fieldY.current.venue ?? 0) - Space.sm),
                  animated: true,
                });
              }}
              returnKeyType="done"
            />
          </View>
          <View
            onLayout={(event) => {
              fieldY.current.note = event.nativeEvent.layout.y;
            }}>
            <FormTextField
              label="Details"
              testID="note-input"
              multiline
              style={styles.noteInput}
              // Not a tram: this app opens on Bangkok, which has no tram
              // network, and an example that names transport the city does not
              // have is the opposite of written by somebody who has been there.
              placeholder="By the door at 7, I'm in a red cap"
              value={note}
              onChangeText={setNote}
              onFocus={() => {
                scrollRef.current?.scrollTo({
                  y: Math.max(0, (fieldY.current.note ?? 0) - Space.sm),
                  animated: true,
                });
              }}
              {...keyboardDoneProps}
            />
          </View>
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={[theme.surface, `${theme.surface}00`]}
          style={styles.fadeTop}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[`${theme.surface}00`, theme.surface]}
          style={styles.fadeBottom}
        />
      </View>
      {/* PINNED, outside the scroller, so the day and the lifetime stay
          readable with the keyboard up. One row of chrome, not a second
          slider: tapping it scrolls the real control into view. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${intentLabel(effectiveIntent)}, gone in ${hoursLabel(effectiveHours)}. Shows the expiry control.`}
        hitSlop={4}
        onPress={() => {
          scrollRef.current?.scrollTo({
            y: Math.max(0, (fieldY.current.expiry ?? 0) - Space.sm),
            animated: true,
          });
        }}>
        <ThemedText
          type="footnote"
          themeColor="textSecondary"
          numberOfLines={1}
          style={styles.expiryReadout}>
          {intentLabel(effectiveIntent)} · gone in {hoursLabel(effectiveHours)}
        </ThemedText>
      </Pressable>
      <PrimaryButton
        label="Put it on the map"
        loading={createPin.isPending}
        disabled={needsPlan}
        // The disabled state is a colour swap (primary-button.tsx), and a
        // colour change is not announced — so the reason has to be spoken.
        accessibilityHint={footnote}
        onPress={submit}
      />
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
        {footnote}
      </ThemedText>
    </Sheet>
  );
}

/**
 * The two shapes a pin can have. Written out rather than a switch, because
 * the difference between them is the sentence under each label and not the
 * boolean.
 */
const JOIN_MODES = [
  {
    open: true,
    label: 'Anyone can join',
    detail: 'One tap and they are in a group chat with you. No hello to answer.',
    glyph: { ios: 'person.3.fill', android: 'group', web: 'group' },
  },
  {
    open: false,
    label: 'Message me first',
    detail: 'They send a hello and you decide, one person at a time.',
    glyph: { ios: 'envelope.fill', android: 'mail', web: 'mail' },
  },
] as const;

function placeLabelFor(place: LocalSearchResult): string | null {
  const label = [place.address, place.locality].filter(Boolean).join(', ');
  return label || null;
}

const styles = StyleSheet.create({
  scrollFrame: {
    // Shrinks with the scroller inside it, so the fades stay glued to the
    // scroll edges however tall the keyboard makes the floor.
    flexShrink: 1,
  },
  fadeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 20,
  },
  fadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 24,
  },
  expiryReadout: {
    textAlign: 'center',
  },
  scroll: {
    // Shrinks rather than overflows: the sheet is capped to the screen and
    // grows a keyboard-sized floor, so this is what gives way.
    flexShrink: 1,
  },
  noteInput: {
    // One line that grows, not two reserved: the height this gives back is
    // what keeps the plan field above the fold now that the day and expiry
    // blocks sit before it.
    minHeight: 40,
    textAlignVertical: 'top',
  },
  form: {
    gap: Space.md,
  },
  sectionLabel: {
    letterSpacing: 0.2,
  },
  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
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
  joinBlock: {
    gap: Space.xs,
  },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: HitTarget,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  joinText: {
    flex: 1,
  },
  note: {
    textAlign: 'center',
  },
});
