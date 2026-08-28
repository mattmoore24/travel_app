import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Space } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/store';
import { useRegisterBusiness, useRequestBusinessEmailCode } from '@/features/business/hooks';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_ORDER } from '@/features/business/vocabulary';
import { useLaunchCities } from '@/features/pins/hooks';
import { LocationPicker } from '@/features/pins/location-picker';
import { StepShell } from '@/features/signup/step-shell';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import type { BusinessCategory } from '@/lib/database.types';
import { haptics } from '@/lib/haptics';

/**
 * The fork that turns a fresh account into a business, in three questions.
 *
 * Same shell, same transitions and the same one-thing-per-screen shape as the
 * traveler steps it forks out of, because it is the same moment in the same
 * sequence: a business account is one whose `onboarding_completed_at` stays
 * NULL forever (docs/BUSINESS_ACCOUNTS.md §3.1), so the offer can only be
 * taken BEFORE that stamp exists, which is while signup is still running.
 */

/**
 * Four, not the three steps that live here. Typing the emailed code on
 * `/business-email` is the last one, and a bar that reads full while the
 * place is still dark would promise something that has not happened yet.
 * Same reason SIGNUP_TOTAL_STEPS counts across two navigation stacks.
 */
const TOTAL_STEPS = 4;

const NAME_MIN = 2;
const NAME_MAX = 80;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMAIL_REASON =
  "Use your business email. It's the address travelers will reach you at, and it's what puts you on the map.";
const EMAIL_PROMISE = "Almost there. We'll email you a code. Type it in and you're on the map.";

function nameProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < NAME_MIN) {
    return 'A business needs a name, even a short one.';
  }
  if (trimmed.length > NAME_MAX) {
    return `That is longer than ${NAME_MAX} characters. Use the name on the sign.`;
  }
  return null;
}

export default function BusinessSignupScreen() {
  // Arriving here is what the flag was for, so put it down. Left up, backing
  // out of this form would land in onboarding and be forwarded straight back,
  // which is a trap rather than a rescue. See features/auth/store.
  const listingDone = useAuthStore((s) => s.listingDone);
  useEffect(() => {
    listingDone();
  }, [listingDone]);

  const launchCitiesQuery = useLaunchCities();
  const launchCities = launchCitiesQuery.data ?? [];
  const registerBusiness = useRegisterBusiness();
  const requestCode = useRequestBusinessEmailCode();

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<BusinessCategory | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [registered, setRegistered] = useState(false);

  const city = launchCities.find((c) => c.city_id === cityId) ?? launchCities[0] ?? null;
  const emailOk = EMAIL_PATTERN.test(email.trim());
  const sending = registerBusiness.isPending || requestCode.isPending;

  const go = (next: number) => {
    haptics.light();
    setTouched(false);
    setStep(next);
  };

  const finish = async () => {
    setTouched(true);
    if (!emailOk || category == null || city == null || coords == null) {
      return;
    }
    try {
      // Registering is not idempotent: one account owns at most one place, so
      // a second press after a mail that failed to send would be refused by
      // the database rather than retried. Remember it and only re-send.
      if (!registered) {
        await registerBusiness.mutateAsync({
          name: name.trim(),
          category,
          cityId: city.city_id,
          lat: coords.lat,
          lng: coords.lng,
        });
        setRegistered(true);
        analytics.capture('business_registered', { category, city_id: city.city_id });
      }
      await requestCode.mutateAsync(email.trim());
      haptics.success();
      // Replace rather than push: the form has been submitted, and a back
      // swipe onto it would offer to submit it a second time.
      //
      // The address travels WITH the route. Without it the code screen cannot
      // name where the mail went and cannot offer to send it again, so a typo
      // or a code lost to a spam folder ended the whole journey: the listing
      // sits unconfirmed, which means dark, with no way forward from inside
      // the app.
      router.replace({ pathname: '/business-email', params: { email: email.trim() } });
    } catch {
      // Surfaced by the global mutation error alert (lib/query-client). Both
      // refusals that matter arrive this way: a marker outside the city's
      // radius, and an account that has already finished a traveler profile.
    }
  };

  if (step === 1) {
    return (
      <StepShell
        step={1}
        total={TOTAL_STEPS}
        title="What's your business called?"
        subtitle="The name over the door, and what kind of business it is."
        note={category == null ? 'Pick what kind of business it is.' : null}
        onBack={router.canGoBack() ? () => router.back() : undefined}
        continueTestID="business-name-continue"
        // Pressable while incomplete on purpose, exactly like the traveler
        // steps: pressing is what marks the field touched, and that is what
        // shows somebody WHY it will not go through.
        onContinue={() => {
          setTouched(true);
          if (nameProblem(name) != null || category == null) {
            return;
          }
          go(2);
        }}>
        <FormTextField
          label="Name"
          testID="business-name-input"
          autoFocus
          placeholder="Casa Amarela, Cafe Janis"
          value={name}
          onChangeText={setName}
          error={touched ? nameProblem(name) : null}
          {...keyboardDoneProps}
        />
        <View style={styles.block}>
          <ThemedText type="callout">What kind of business?</ThemedText>
          <CategoryGrid value={category} onChange={setCategory} />
        </View>
      </StepShell>
    );
  }

  if (step === 2) {
    return (
      <StepShell
        step={2}
        total={TOTAL_STEPS}
        title="Where is it?"
        subtitle="Drop the marker on your door."
        note={coords == null ? 'Tap the map to put the marker down.' : null}
        onBack={() => go(1)}
        continueTestID="business-place-continue"
        onContinue={() => {
          if (coords == null || city == null) {
            return;
          }
          go(3);
        }}
        footer={
          launchCitiesQuery.isError ? (
            <PrimaryButton
              variant="ghost"
              label="Try loading the cities again"
              onPress={() => launchCitiesQuery.refetch()}
            />
          ) : undefined
        }>
        {launchCities.length > 0 ? (
          <View style={styles.block}>
            <ThemedText type="callout">Which city?</ThemedText>
            <ChipRow
              options={launchCities.map((c) => ({
                value: String(c.city_id),
                label: c.cities.name,
              }))}
              selected={city ? [String(city.city_id)] : []}
              onToggle={(value) => {
                setCityId(Number(value));
                // A marker belongs to the city it was placed in, so switching
                // city has to start over rather than leave a point sitting in
                // the old one, which the server would refuse anyway.
                setCoords(null);
              }}
            />
          </View>
        ) : null}
        {city ? (
          <LocationPicker
            // Remounted on a city change: the picker reads its centre once,
            // through initialRegion, so without this the map keeps showing
            // the city that was chosen first.
            key={city.city_id}
            centerLat={city.cities.lat}
            centerLng={city.cities.lng}
            lat={coords?.lat ?? city.cities.lat}
            lng={coords?.lng ?? city.cities.lng}
            onChange={(lat, lng) => setCoords({ lat, lng })}
          />
        ) : (
          <ThemedText themeColor="textSecondary">
            {launchCitiesQuery.isError
              ? 'The map could not load the cities. Check your connection and try again.'
              : 'Getting the map ready.'}
          </ThemedText>
        )}
      </StepShell>
    );
  }

  return (
    <StepShell
      step={3}
      total={TOTAL_STEPS}
      title="What's your business email?"
      continueLabel="Email me a code"
      continueTestID="business-email-continue"
      continueLoading={sending}
      note={EMAIL_PROMISE}
      onBack={() => go(2)}
      onContinue={finish}>
      <FormTextField
        label="Email"
        testID="business-email-input"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
        error={touched && !emailOk ? 'That address looks off. Check it over.' : null}
        {...keyboardDoneProps}
      />
      {/* Its own line rather than the field's hint, which an error replaces:
          this is the reason the address is being asked for at all, and it has
          to survive a typo. */}
      <ThemedText type="footnote" themeColor="textSecondary">
        {EMAIL_REASON}
      </ThemedText>
    </StepShell>
  );
}

/**
 * The thirteen kinds of place, as chips with their own glyph.
 *
 * A grid rather than a dropdown because the whole list is short enough to
 * read at once, and somebody who runs a guesthouse should see the word
 * "Guesthouse" without opening anything.
 */
function CategoryGrid({
  value,
  onChange,
}: {
  value: BusinessCategory | null;
  onChange: (category: BusinessCategory) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.grid}>
      {CATEGORY_ORDER.map((category) => {
        const selected = category === value;
        return (
          <PressableScale
            key={category}
            accessibilityRole="button"
            accessibilityLabel={CATEGORY_LABEL[category]}
            accessibilityState={{ selected }}
            haptic="selection"
            scaleTo={0.94}
            // A chip is about 34pt tall at the default text size. The slop
            // pays the 44pt floor without inflating the chip into a button.
            hitSlop={{ top: 6, bottom: 6 }}
            onPress={() => onChange(category)}
            style={[
              styles.chip,
              { backgroundColor: selected ? theme.accent : theme.surfaceSunken },
            ]}>
            {/* vocabulary.ts types the icon names as plain strings, which is
                right for a file that also has to name Material glyphs. */}
            <SymbolView
              name={CATEGORY_ICON[category] as SymbolViewProps['name']}
              size={15}
              tintColor={selected ? theme.onAccent : theme.textSecondary}
            />
            <ThemedText type="footnote" style={{ color: selected ? theme.onAccent : theme.text }}>
              {CATEGORY_LABEL[category]}
            </ThemedText>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Space.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
  },
});
