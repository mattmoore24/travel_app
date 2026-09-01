import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { ChipRail } from '@/components/form/chip-rail';
import { FormTextField } from '@/components/form/form-text-field';
import { HoursSlider } from '@/components/form/hours-slider';
import { PinGlyph } from '@/features/pins/pin-marker';
import { PrimaryButton } from '@/components/form/primary-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { ThemedText } from '@/components/themed-text';
import { HitTarget, Radius, Space, Type } from '@/constants/theme';
import { useCreatePin } from '@/features/pins/hooks';
import {
  MAX_PIN_HOURS,
  categoryForPlan,
  categoryForPoi,
  cityClockNow,
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
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import type { LocalSearchResult } from '@/modules/local-search';

/**
 * The composer's funnel, three steps wide and no wider.
 *
 * Pin creation rate is a §6 metric and it used to be two events across: the
 * map was viewed, and then a pin either existed or did not. That says the
 * number is low and nothing about why, which is the difference between three
 * completely different fixes — the composer is too long, the place search is
 * failing, or travelers do not want to publish intent at all.
 *
 * Only the REQUIRED path is a step, and that is what keeps the funnel
 * readable. The day, the lifetime and the join mode all arrive with sensible
 * defaults, so touching them is not progress and counting them would put
 * optional detours below the gate in the chart. What is left is: the spot has
 * a name (however it got one — search, the geocoder, or typed), the plan has
 * words in it (the only thing the submit button waits for), and the button
 * was pressed. Each fires at most once, never per keystroke.
 */
const COMPOSE_STEPS = ['spot_named', 'plan_written', 'submitted'] as const;
type ComposeStep = (typeof COMPOSE_STEPS)[number];

/** iOS toolbar id: gives the multiline field a way out of the keyboard. */
type PinFormSheetProps = {
  cityId: number;
  cityName: string;
  /**
   * The city's IANA zone (launch_cities.timezone), so the day chips and the
   * written intent_date are the CITY's calendar. A pin dropped from an
   * airport lounge lands on the destination's date; the validate_pin
   * trigger's current_date -1/+2 window absorbs the offset in both
   * directions. Null falls back to a longitude approximation of the pin's
   * own coordinate (cityClockNow).
   */
  cityTimezone?: string | null;
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
 * bar, and when it did not, the plan's own words answer instead
 * (categoryForPlan), previewed live by the marker in the place card.
 */
export function PinFormSheet({
  cityId,
  cityName,
  cityTimezone = null,
  coords,
  initialPlace = null,
  initialLabel = null,
  onClose,
  onPosted,
}: PinFormSheetProps) {
  const theme = useTheme();
  const createPin = useCreatePin();
  // The SPOT's name - from search, or the map pill's reverse geocode - and
  // editable, because "Somdet Phra Pokklao Bridge" is where you are, not
  // necessarily what you would call it. The plan lives in its own field now:
  // one column was being asked to be two things, and three strings broke
  // downstream (the compose draft, clusterTitle, the marker's spoken label).
  const [venue, setVenue] = useState(initialPlace?.name ?? initialLabel ?? '');
  const venueTouched = useRef(false);
  const [plan, setPlan] = useState('');
  const [note, setNote] = useState('');
  const [placeLabel, setPlaceLabel] = useState<string | null>(
    initialPlace ? placeLabelFor(initialPlace) : initialLabel
  );
  const [intentDate, setIntentDate] = useState(() =>
    toISODate(cityClockNow(cityTimezone, coords.lng))
  );
  const [hours, setHours] = useState(() =>
    defaultHoursForIntent(toISODate(cityClockNow(cityTimezone, coords.lng)))
  );
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

  // How far this composer got. Refs, not state: nothing on screen depends on
  // them, and the unmount handler below has to read them AFTER the last
  // render, which is the one thing a state variable cannot give it.
  const reached = useRef<ComposeStep[]>([]);
  const posted = useRef(false);
  const reachStep = useCallback((step: ComposeStep) => {
    if (reached.current.includes(step)) {
      return;
    }
    reached.current.push(step);
    analytics.capture('pin_compose_step', {
      step,
      step_index: COMPOSE_STEPS.indexOf(step) + 1,
    });
  }, []);

  // Watching the VALUE, not the keystroke: both of these fire the first time
  // their field is non-empty and never again, so a person typing a plan
  // sends one event rather than thirty. A venue that arrived pre-filled
  // counts, and that is deliberate — this step never firing is exactly what
  // "place search is failing" looks like from the chart.
  useEffect(() => {
    if (venue.trim().length > 0) {
      reachStep('spot_named');
    }
  }, [venue, reachStep]);
  useEffect(() => {
    if (plan.trim().length > 0) {
      reachStep('plan_written');
    }
  }, [plan, reachStep]);

  // Left without posting. The furthest step in the canonical order, not the
  // most recent one reached: the form is a scroller, not a wizard, so
  // somebody can write the plan before naming the spot, and a funnel that
  // took the chronological answer would report them as going backwards.
  useEffect(
    () => () => {
      if (posted.current) {
        return;
      }
      const furthest = reached.current.reduce(
        (best, step) => Math.max(best, COMPOSE_STEPS.indexOf(step)),
        -1
      );
      analytics.capture('pin_compose_abandoned', {
        last_step: furthest < 0 ? 'none' : COMPOSE_STEPS[furthest],
      });
    },
    []
  );

  // The marker's kind. Apple's POI category leads when the place came from
  // search or a venue chip; a hand-placed pin has none, so the PLAN's own
  // words are read instead (founder decision D10: no chip rail, fix the
  // inference). Recomputed per keystroke on purpose — the place card's
  // glyph below previews the pin being dropped, so the guess is visible
  // before it is committed, which is what makes guessing defensible.
  const poiCategory = categoryForPoi(initialPlace?.category);
  const category = poiCategory !== 'other' ? poiCategory : (categoryForPlan(plan) ?? 'other');

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
        // Seed the editable venue name too, but never over something the
        // person has already typed.
        if (label && !venueTouched.current) {
          setVenue((current) => (current ? current : label));
        }
      })
      .catch(() => {
        // No label is fine; the pin still knows exactly where it is.
      });
    return () => {
      active = false;
    };
  }, [coords.lat, coords.lng, initialLabel, initialPlace]);

  // Recomputed per render: the sheet can sit open across midnight, and a
  // stale "today" would post an already-expired pin. The CITY's midnight -
  // its clock owns the word on this whole surface (cityClockNow).
  const cityClock = cityClockNow(cityTimezone, coords.lng);
  const todayISO = toISODate(cityClock);
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
  const needsPlan = plan.trim().length === 0;
  const footnote = needsPlan
    ? 'Say what the plan is first.'
    : 'A plan, not your location. It disappears on its own.';

  // The plan text is what makes the difference between a marker and an
  // invitation, and the sheet's pull-down and scrim are one careless thumb
  // away from a person mid-sentence over a live keyboard. So a dismissal
  // GESTURE asks first when anything has been written — the same voice as
  // edit-profile's guard, which admits in its own comment that a swipe once
  // ate a whole bio rewrite in silence. The pre-filled venue does not count
  // unless the person edited it: search and the geocoder wrote that, and a
  // guard that fires on text the app typed is asking about work nobody did.
  // Raising the Alert while the sheet is still mounted and presented is
  // safe (UIAlertController presents over the sheet's own view controller);
  // dismissing FIRST and alerting later is the presentation iOS drops.
  const requestClose = () => {
    const wrote =
      plan.trim().length > 0 ||
      note.trim().length > 0 ||
      (venueTouched.current && venue.trim().length > 0);
    if (!wrote) {
      onClose();
      return;
    }
    Alert.alert('Discard this plan?', "You'll lose what you wrote.", [
      { text: 'Keep writing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const submit = async () => {
    // Before the await, so a post that never comes back still counts as a
    // press. The gap between this step and pin_created is where
    // pin_post_failed lives (features/pins/hooks.ts).
    reachStep('submitted');
    try {
      const pin = await createPin.mutateAsync({
        cityId,
        // The DB requires a venue (1..80). When neither search nor the
        // geocoder named the spot and the person left the field alone, the
        // address, then the city, stand in - both true, neither a plan.
        venueName: (venue.trim() || placeLabel || cityName).slice(0, 80),
        plan: plan.trim() || null,
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
      // Set before the parent is told, because being told is what unmounts
      // this sheet: pin_created and pin_compose_abandoned must never both
      // describe the same composer.
      posted.current = true;
      onPosted(pin.id);
    } catch {
      // Surfaced by the global mutation error alert (e.g. outside geofence).
    }
  };

  return (
    <Sheet onClose={onClose} onCloseRequest={requestClose} avoidKeyboard>
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
              {/* EDITABLE. The search result or the reverse geocode fills it
                in, and the person can correct it - the address of the spot
                is not always what anybody calls the spot. A plain opaque
                input, never inside glass (a TextInput under a
                UIVisualEffectView never receives its tap - see traps). */}
              <TextInput
                testID="venue-name-input"
                accessibilityLabel="Name of the spot"
                value={venue}
                onChangeText={(text) => {
                  venueTouched.current = true;
                  setVenue(text);
                }}
                placeholder={`Where you dropped it in ${cityName}`}
                placeholderTextColor={theme.textTertiary}
                maxLength={80}
                style={[styles.venueInput, { color: theme.text }]}
                returnKeyType="done"
              />
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
            options={intentDateOptions(cityClock)}
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
              fieldY.current.plan = event.nativeEvent.layout.y;
            }}>
            <FormTextField
              label="What's the plan?"
              testID="plan-input"
              placeholder="Sunset drinks, morning surf"
              value={plan}
              onChangeText={setPlan}
              maxLength={80}
              onFocus={() => {
                scrollRef.current?.scrollTo({
                  y: Math.max(0, (fieldY.current.plan ?? 0) - Space.sm),
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
        accessibilityLabel={`${intentLabel(effectiveIntent, cityClock)}, gone in ${hoursLabel(effectiveHours)}. Shows the expiry control.`}
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
          {intentLabel(effectiveIntent, cityClock)} · gone in {hoursLabel(effectiveHours)}
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
    detail: 'One tap and they are in a group chat with you. Nothing to accept.',
    glyph: { ios: 'person.3.fill', android: 'group', web: 'group' },
  },
  {
    open: false,
    label: 'Message me first',
    detail: 'They send a first message and you decide, one person at a time.',
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
  // The callout role's metrics, as an input: the card's name line, editable.
  venueInput: {
    ...Type.callout,
    padding: 0,
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
