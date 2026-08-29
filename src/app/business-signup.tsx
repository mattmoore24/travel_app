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
import {
  useBusinessDetail,
  useOwnBusiness,
  useRegisterBusiness,
  useRequestBusinessEmailCode,
} from '@/features/business/hooks';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_ORDER } from '@/features/business/vocabulary';
import { countOf } from '@/lib/plural';
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
/**
 * Twelve, counting the code screen that lives on its own route: typing the
 * emailed digits is the last step, and a bar that reads full while the place
 * is still dark would promise something that has not happened yet. Same
 * reason SIGNUP_TOTAL_STEPS counts across two navigation stacks.
 *
 * Two of the twelve — the email and the password — are on /join, so this form
 * starts at three. See docs/ONBOARDING.md §4.
 */
const TOTAL_STEPS = 12;

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

/**
 * The same sentence on every step that has one, in the same place, and the
 * same constant the traveler flow uses for the same reason: the moment
 * thirteen hand-written reassurances drift they stop reading as a promise.
 */
const CHANGE_LATER = 'You can change this any time, from your business page.';

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
  // The row, once it exists. Registering happens at the confirm step rather
  // than at the end, because everything after it — photos, hours, links — is
  // an ordinary edit of an existing business, exactly as it will be forever
  // afterwards from the storefront screen. An `unconfirmed` business is fully
  // dark until the code goes in, so building the page while it waits costs
  // nobody anything (docs/BUSINESS_ACCOUNTS.md §3.9).
  const { data: business } = useOwnBusiness();
  const { data: detail } = useBusinessDetail(business?.id ?? null);

  // Three, not one. Steps 1 and 2 (email, password) live on /join, and the
  // bar is continuous across the two stacks.
  const [step, setStep] = useState(3);
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

  const go = (next: number) => {
    haptics.light();
    setTouched(false);
    setStep(next);
  };

  /**
   * Create the row, at the confirm step rather than at the end.
   *
   * Everything after this is an ordinary edit of an existing business — the
   * same edits the storefront screen makes forever afterwards — and an
   * `unconfirmed` listing is fully dark until the code goes in, so there is
   * nothing on the map to be half-finished.
   *
   * Not idempotent: one account owns at most one business, so a second press
   * would be refused by the database rather than retried.
   */
  const register = async () => {
    if (category == null || city == null || coords == null) {
      return;
    }
    if (registered || business != null) {
      go(6);
      return;
    }
    try {
      await registerBusiness.mutateAsync({
        name: name.trim(),
        category,
        cityId: city.city_id,
        lat: coords.lat,
        lng: coords.lng,
        address: address.trim() || null,
      });
      setRegistered(true);
      analytics.capture('business_registered', { category, city_id: city.city_id });
      go(6);
    } catch {
      // Surfaced by the global mutation error alert (lib/query-client). Three
      // refusals arrive this way: an account that has already finished a
      // traveler profile, a city we have not launched in, and — new since
      // 20260829160000, and previously claimed here but never true — a marker
      // outside the city's radius.
    }
  };

  /** The contact rows, written once the row they hang off exists. */
  const saveContacts = async () => {
    setTouched(true);
    if (!emailOk) {
      return;
    }
    const businessId = business?.id;
    if (businessId == null) {
      return;
    }
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
        // Off the critical path deliberately: a number the validator refuses
        // must not cost somebody the listing they have already registered,
        // and every one of these is editable from the business page.
      }
    }
    go(7);
  };

  /** The last thing this form does. The code screen takes it from here. */
  const sendCode = async () => {
    if (!emailOk) {
      return;
    }
    try {
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
      // Surfaced by the global mutation error alert. The refusal that matters
      // is the fifth code of the day.
    }
  };

  if (step === 3) {
    return (
      <StepShell
        step={3}
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
          go(4);
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

  if (step === 4) {
    return (
      <StepShell
        step={4}
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
        onBack={() => go(3)}
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

  if (step === 5) {
    return (
      <StepShell
        step={5}
        total={TOTAL_STEPS}
        title="Is this right?"
        subtitle="This is what a traveler sees when they tap you on the map."
        continueLabel="Yes, that's us"
        onBack={() => go(4)}
        continueTestID="business-confirm-place"
        continueLoading={registerBusiness.isPending}
        onContinue={register}>
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
        <PrimaryButton variant="ghost" label="Fix the address" onPress={() => go(4)} />
        <ThemedText type="footnote" themeColor="textSecondary">
          Both of these are yours to change later. Moving the marker after you go live sends the
          listing back for another email check, so it is worth getting right now.
        </ThemedText>
      </StepShell>
    );
  }

  if (step === 6) {
    return (
      <StepShell
        step={6}
        total={TOTAL_STEPS}
        title="How do people reach you?"
        subtitle="The email is the one we need. The rest is up to you."
        continueTestID="business-contact-continue"
        onBack={() => go(5)}
        onContinue={saveContacts}>
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
            this is the reason the address is being asked for at all, and it
            has to survive a typo. */}
        <ThemedText type="footnote" themeColor="textSecondary">
          {EMAIL_REASON}
        </ThemedText>

        {/* Founder, 2026-08-29: "No need to require a code for phone or
            WhatsApp for now. Just add those as a contact option without
            requiring a code for now." So they are contact details and nothing
            else — no code, no verification, no claim that either proves
            anything. They land as business_links rows, which is where every
            other way of reaching a business already lives and which already
            validates a phone number. */}
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

  // THE PAGE ITSELF, four steps of it.
  //
  // All four were in docs/BUSINESS_ACCOUNTS.md §5 and none of them was ever
  // built, so an owner finished signup and had to go and find the storefront
  // screen to discover that photos, hours and links existed at all. That is
  // the confusion the founder hit. Each step says what the section is for and
  // hands over to the editor that already owns it — the same editor they will
  // use forever afterwards, rather than a second copy living inside signup.

  if (step === 7) {
    const photoCount = detail?.photos?.length ?? 0;
    return (
      <StepShell
        step={7}
        total={TOTAL_STEPS}
        title="Show the place"
        subtitle="Photos of the business, not of a person. The first one is your cover, and it is the thing travelers see on the map."
        continueLabel={photoCount > 0 ? 'Continue' : 'Add photos'}
        continueTestID="business-photos-continue"
        note={photoCount > 0 ? CHANGE_LATER : 'One photo is the only thing we need here.'}
        onBack={() => go(6)}
        onContinue={() =>
          photoCount > 0
            ? go(8)
            : router.push({ pathname: '/business-edit', params: { section: 'photos' } })
        }>
        <PrimaryButton
          variant="ghost"
          label={photoCount > 0 ? `${photoCount} added. Add more` : 'Add photos'}
          testID="business-add-photos"
          onPress={() => router.push({ pathname: '/business-edit', params: { section: 'photos' } })}
        />
      </StepShell>
    );
  }

  if (step === 8) {
    return (
      <StepShell
        step={8}
        total={TOTAL_STEPS}
        title="What is it like?"
        subtitle="A couple of lines a traveler would actually want to read. Not a menu, not an advert."
        continueTestID="business-description-continue"
        note={CHANGE_LATER}
        onBack={() => go(7)}
        onSkip={() => go(9)}
        onContinue={() =>
          detail?.description
            ? go(9)
            : router.push({ pathname: '/business-edit', params: { section: 'details' } })
        }>
        {detail?.description ? (
          <View style={[styles.confirmCard, { backgroundColor: theme.surfaceSunken }]}>
            <ThemedText>{detail.description}</ThemedText>
          </View>
        ) : null}
        <PrimaryButton
          variant="ghost"
          label={detail?.description ? 'Change it' : 'Write it'}
          onPress={() =>
            router.push({ pathname: '/business-edit', params: { section: 'details' } })
          }
        />
      </StepShell>
    );
  }

  if (step === 9) {
    const hourCount = detail?.hours?.length ?? 0;
    return (
      <StepShell
        step={9}
        total={TOTAL_STEPS}
        title="When are you open?"
        subtitle="Past midnight is fine. 20:00 to 2:00 reads as one night."
        continueTestID="business-hours-continue"
        note={CHANGE_LATER}
        onBack={() => go(8)}
        onSkip={hourCount > 0 ? undefined : () => go(10)}
        onContinue={() =>
          hourCount > 0
            ? go(10)
            : router.push({ pathname: '/business-edit', params: { section: 'hours' } })
        }>
        <PrimaryButton
          variant="ghost"
          label={hourCount > 0 ? 'Change your hours' : 'Set your hours'}
          onPress={() => router.push({ pathname: '/business-edit', params: { section: 'hours' } })}
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          No hours is better than wrong hours. Somebody standing outside a closed door because your
          page said otherwise is worse than not knowing.
        </ThemedText>
      </StepShell>
    );
  }

  if (step === 10) {
    const linkCount = detail?.links?.length ?? 0;
    return (
      <StepShell
        step={10}
        total={TOTAL_STEPS}
        title="Anywhere else to send people?"
        subtitle="A menu, a booking page, your Instagram. One list for links, socials and contact."
        continueTestID="business-links-continue"
        note={CHANGE_LATER}
        onBack={() => go(9)}
        onSkip={() => go(11)}
        onContinue={() => go(11)}>
        <PrimaryButton
          variant="ghost"
          label={linkCount > 0 ? `${linkCount} on your page. Add more` : 'Add a link'}
          onPress={() => router.push({ pathname: '/business-edit', params: { section: 'links' } })}
        />
      </StepShell>
    );
  }

  if (step === 11) {
    return (
      <StepShell
        step={11}
        total={TOTAL_STEPS}
        title="Here it is"
        subtitle="Exactly what a traveler sees when they tap you. Step back to change anything."
        continueLabel="Looks right"
        continueTestID="business-review-continue"
        note="Every part of this is editable from your business page afterwards."
        onBack={() => go(10)}
        onContinue={() => go(12)}>
        <View style={[styles.confirmCard, { backgroundColor: theme.surfaceSunken }]}>
          <ThemedText type="headline">{detail?.name ?? name.trim()}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {category ? CATEGORY_LABEL[category] : ''}
            {city ? ` · ${city.cities.name}` : ''}
          </ThemedText>
          {detail?.address ? <ThemedText type="body">{detail.address}</ThemedText> : null}
          {detail?.description ? <ThemedText type="body">{detail.description}</ThemedText> : null}
          <ThemedText type="footnote" themeColor="textSecondary">
            {countOf(detail?.photos?.length ?? 0, 'photo')} ·{' '}
            {countOf(detail?.links?.length ?? 0, 'link')} ·{' '}
            {(detail?.hours?.length ?? 0) > 0 ? 'hours set' : 'no hours yet'}
          </ThemedText>
        </View>
      </StepShell>
    );
  }

  return (
    <StepShell
      step={12}
      total={TOTAL_STEPS}
      title="One last thing"
      subtitle="Nobody can find you until an email proves somebody reads that inbox. That is the whole of it."
      continueLabel="Email me a code"
      continueTestID="business-email-continue"
      continueLoading={requestCode.isPending}
      note={EMAIL_PROMISE}
      onBack={() => go(11)}
      onContinue={sendCode}>
      <View style={[styles.confirmCard, { backgroundColor: theme.surfaceSunken }]}>
        <ThemedText type="caption" themeColor="textSecondary">
          SENDING IT TO
        </ThemedText>
        <ThemedText type="headline">{email.trim()}</ThemedText>
      </View>
      <PrimaryButton variant="ghost" label="Use a different address" onPress={() => go(6)} />
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
