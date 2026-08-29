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
import { addBusinessLink } from '@/features/business/api';
import { BusinessAddressField, addressFrom } from '@/features/business/address-field';
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
const TOTAL_STEPS = 5;

/** businesses.address is capped at 160 in the column CHECK. */
const ADDRESS_MAX = 160;

const NAME_MIN = 2;
const NAME_MAX = 80;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The old line said the confirmation address was "the address travelers will
// reach you at". It never was: it lives in business_email_confirmations, a
// table with no client grants at all, and no traveler has ever seen it. What
// travelers reach you on is what you put on this step.
const EMAIL_REASON =
  'The code goes here, and this is the address travelers write to. Change any of it later from your business page.';
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
  const theme = useTheme();
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
  // Two pieces of state on purpose, and this is the founder's rule in code:
  // "keep their address the same as whatever they entered while adjusting the
  // pin location if needed". Picking a suggestion writes both; typing writes
  // only the words; dragging the marker writes only the coordinates.
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [touched, setTouched] = useState(false);
  const [registered, setRegistered] = useState(false);

  // Chosen, never assumed. This used to fall back to `launchCities[0]`, so
  // somebody who never touched the chips registered in whatever city the query
  // happened to return first — and until 20260829160000 the server did not
  // check either, so a marker in Bangkok could be filed under Lisbon.
  const city = cityId != null ? (launchCities.find((c) => c.city_id === cityId) ?? null) : null;
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
      // Registering is not idempotent: one account owns at most one business,
      // so a second press after a mail that failed to send would be refused by
      // the database rather than retried. Remember it and only re-send.
      if (!registered) {
        const businessId = await registerBusiness.mutateAsync({
          name: name.trim(),
          category,
          cityId: city.city_id,
          lat: coords.lat,
          lng: coords.lng,
          address: address.trim() || null,
        });
        setRegistered(true);
        analytics.capture('business_registered', { category, city_id: city.city_id });

        // The contact rows, best effort and in that order. A phone number that
        // the validator refuses must not cost somebody the listing they just
        // registered: the number is editable from the business page forever
        // afterwards, and the code is the thing standing between them and the
        // map. Every one of these is optional by design (founder, 2026-08-29:
        // "add those as a contact option without requiring a code for now").
        const contacts: { kind: 'email' | 'phone' | 'whatsapp'; label: string; value: string }[] = [
          { kind: 'email', label: 'Email', value: email.trim() },
          { kind: 'phone', label: 'Phone', value: phone.trim() },
          { kind: 'whatsapp', label: 'WhatsApp', value: whatsapp.trim() },
        ];
        let position = 0;
        for (const contact of contacts) {
          if (contact.value.length === 0) {
            continue;
          }
          try {
            await addBusinessLink({ businessId, ...contact, position });
            position += 1;
          } catch {
            // Kept off the critical path deliberately; see above.
          }
        }
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
      // Surfaced by the global mutation error alert (lib/query-client). Three
      // refusals arrive this way: an account that has already finished a
      // traveler profile, a city we have not launched in, and — new since
      // 20260829160000, and previously claimed here but never true — a marker
      // outside the city's radius.
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
        subtitle="Type your address, then check the marker is on your door."
        note={
          city == null
            ? 'Pick your city first.'
            : coords == null
              ? 'Pick a suggestion, or drag the marker onto your door.'
              : null
        }
        onBack={() => go(1)}
        continueTestID="business-place-continue"
        onContinue={() => {
          setTouched(true);
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
                // A marker belongs to the city it was placed in, and since
                // 20260829160000 the server agrees: register_business runs the
                // same radius check pins have. The address goes with it, since
                // a street in Lisbon is not a street in Bangkok.
                setCoords(null);
                setAddress('');
              }}
            />
          </View>
        ) : null}
        {city ? (
          <>
            {/* The address is the DEFAULT way in, which is why it is first and
                why the marker below starts at the city centre rather than
                demanding a tap. Somebody who would rather just place the pin
                types nothing and drags; the field being here does not make it
                a requirement. */}
            <BusinessAddressField
              value={address}
              cityName={city.cities.name}
              cityLat={city.cities.lat}
              cityLng={city.cities.lng}
              onChangeText={(next) => setAddress(next.slice(0, ADDRESS_MAX))}
              onPick={(place) => {
                setAddress(addressFrom(place));
                setCoords({ lat: place.latitude, lng: place.longitude });
              }}
            />
            <LocationPicker
              // Remounted on a city change: the picker reads its centre once,
              // through initialRegion, so without this the map keeps showing
              // the city that was chosen first.
              key={city.city_id}
              centerLat={city.cities.lat}
              centerLng={city.cities.lng}
              lat={coords?.lat ?? city.cities.lat}
              lng={coords?.lng ?? city.cities.lng}
              // Only the marker. The address stays exactly as typed, which is
              // the founder's rule and the reason these are two fields.
              onChange={(lat, lng) => setCoords({ lat, lng })}
            />
            {address.trim().length > 0 && coords != null ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                Move the marker as much as you like. Your address stays as you wrote it.
              </ThemedText>
            ) : null}
          </>
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

  if (step === 3) {
    return (
      <StepShell
        step={3}
        total={TOTAL_STEPS}
        title="Is this right?"
        subtitle="This is what a traveler sees when they tap you on the map."
        continueLabel="Yes, that's us"
        onBack={() => go(2)}
        continueTestID="business-confirm-place"
        onContinue={() => go(4)}>
        <View style={[styles.confirmCard, { backgroundColor: theme.surfaceSunken }]}>
          <ThemedText type="headline">{name.trim()}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {category ? CATEGORY_LABEL[category] : ''}
            {city ? ` · ${city.cities.name}` : ''}
          </ThemedText>
          <ThemedText type="body">
            {address.trim().length > 0 ? address.trim() : 'No address, just the marker.'}
          </ThemedText>
        </View>
        {city && coords ? (
          <LocationPicker
            key={`confirm-${city.city_id}`}
            centerLat={coords.lat}
            centerLng={coords.lng}
            lat={coords.lat}
            lng={coords.lng}
            onChange={(lat, lng) => setCoords({ lat, lng })}
          />
        ) : null}
        <PrimaryButton variant="ghost" label="Fix the address" onPress={() => go(2)} />
        <ThemedText type="footnote" themeColor="textSecondary">
          Both of these are yours to change later. Moving the marker after you go live sends the
          listing back for another email check, so it is worth getting right now.
        </ThemedText>
      </StepShell>
    );
  }

  return (
    <StepShell
      step={4}
      total={TOTAL_STEPS}
      title="How do people reach you?"
      subtitle="The email is the one we need. The rest is up to you."
      continueLabel="Email me a code"
      continueTestID="business-email-continue"
      continueLoading={sending}
      note={EMAIL_PROMISE}
      onBack={() => go(3)}
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

      {/* Founder, 2026-08-29: "No need to require a code for phone or WhatsApp
          for now. Just add those as a contact option without requiring a code
          for now." So they are contact details and nothing else — no code, no
          verification, no claim that either proves anything. They land as
          business_links rows, which is where every other way of reaching a
          business already lives and which already validates a phone number. */}
      <View style={styles.block}>
        <ThemedText type="callout">Phone or WhatsApp</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Both optional, and both show as a button on your page.
        </ThemedText>
        <FormTextField
          label="Phone"
          testID="business-phone-input"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          placeholder="+351 912 345 678"
          value={phone}
          onChangeText={setPhone}
          {...keyboardDoneProps}
        />
        <FormTextField
          label="WhatsApp"
          testID="business-whatsapp-input"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="phone-pad"
          placeholder="Same number, or a different one"
          value={whatsapp}
          onChangeText={setWhatsapp}
          {...keyboardDoneProps}
        />
      </View>
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
  confirmCard: {
    gap: Space.xs,
    padding: Space.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
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
