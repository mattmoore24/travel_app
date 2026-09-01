import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/store';
import { replaceBusinessContacts, type ContactKind } from '@/features/business/api';
import { BusinessAddressField, addressFrom } from '@/features/business/address-field';
import { PlaceGlyph } from '@/features/business/business-marker';
import { BusinessPhotos, useBusinessPhotos } from '@/features/business/business-photos';
import {
  useBusinessCodeStatus,
  useBusinessDetail,
  useCityBusinesses,
  useConfirmBusinessEmail,
  useOwnBusiness,
  useRecordListingIntent,
  useRegisterBusiness,
  useRequestBusinessEmailCode,
  useUpdateBusinessLocation,
} from '@/features/business/hooks';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  openLine,
} from '@/features/business/vocabulary';
import { countOf } from '@/lib/plural';
import { useLaunchCities } from '@/features/pins/hooks';
import { LocationPicker } from '@/features/pins/location-picker';
import { useOwnUserId } from '@/features/profile/hooks';
import { BUSINESS_TOTAL_STEPS } from '@/features/signup/steps';
import { StepShell } from '@/features/signup/step-shell';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import type { BusinessCategory, BusinessDetailRow } from '@/lib/database.types';
import { haptics } from '@/lib/haptics';

/**
 * The fork that turns a fresh account into a business, in three questions.
 *
 * Same shell, same transitions and the same one-thing-per-screen shape as the
 * traveler steps it forks out of, because it is the same moment in the same
 * sequence: a business account is one whose `onboarding_completed_at` stays
 * NULL forever (docs/BUSINESS_ACCOUNTS.md §3.1), so the offer can only be
 * taken BEFORE that stamp exists, which is while signup is still running.
 *
 * Thirteen screens, counted in features/signup/steps.ts because the sequence
 * spans two navigation stacks: steps 1 and 2 (the email and the password) are
 * on /join, steps 3 to 12 are this form, and step 13 is the emailed code on
 * its own route. See docs/ONBOARDING.md §4.
 */

/**
 * "four cities", spelled out the way a sentence says it. Digits past nine,
 * by which point the sentence will have been rewritten anyway.
 */
function cityCountWord(count: number): string {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const word = words[count] ?? String(count);
  return count === 1 ? `${word} city` : `${word} cities`;
}

/**
 * A stable slug per 1-based step, for `business_step_completed` — the same
 * `{ step_index, step_name }` shape signup_step_completed sends, so one
 * funnel vocabulary covers both flows. Steps 1 and 2 (email, password) live
 * on /join and are counted there with `business: true`.
 *
 * `offer` was inserted at step 3 and every later index moved with it, so a
 * funnel drawn across the change has a seam in it. The alternative was
 * leaving the slugs pointing at the wrong screens, which is worse: a name
 * that lies is harder to notice than a date the numbers jump on.
 */
const BUSINESS_STEP_NAMES = [
  'email',
  'password',
  'offer',
  'name',
  'address',
  'confirm',
  'contacts',
  'photos',
  'description',
  'hours',
  'links',
  'review',
  'code',
] as const;

function businessStepName(step: number): string {
  return BUSINESS_STEP_NAMES[step - 1] ?? `step-${step}`;
}

/** businesses.address is capped at 160 in the column CHECK. */
const ADDRESS_MAX = 160;

const NAME_MIN = 2;
const NAME_MAX = 80;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Six digits, and twenty minutes, both the migration's numbers. */
const CODE_LENGTH = 6;
const CODE_TTL_MS = 20 * 60 * 1000;

// The old line said the confirmation address was "the address travelers will
// reach you at". It never was: it lives in business_email_confirmations, a
// table with no client grants at all, and no traveler has ever seen it. What
// travelers reach you on is what you put on this step.
//
// And it now says what the email COSTS, on the screen that asks for it. The
// consequence used to be sprung one screen from the end, under the heading
// "Exactly what a traveler sees when they tap you", which made the whole
// review step read as a bait: register_business has already inserted the row
// as 'unconfirmed' and city_businesses filters on `state = 'listed'`, so an
// owner who abandoned in their mail app had done nine screens of work that
// produce a row no traveler can see.
const EMAIL_REASON =
  'The code goes here, and this is the address travelers write to. Nobody can find you on the map until you type that code in.';
const EMAIL_PROMISE = "Almost there. We'll email you a code. Type it in and you're on the map.";

/**
 * The same sentence on every step that has one, in the same place, and the
 * same constant the traveler flow uses for the same reason: the moment
 * thirteen hand-written reassurances drift they stop reading as a promise.
 */
const CHANGE_LATER = 'You can change this any time, from your business page.';

/** The database's own ceiling for a phone or WhatsApp number. */
const CONTACT_MAX = 30;

/** What a refused contact is called, in the words on its own field. */
const CONTACT_LABEL = (kind: ContactKind): string =>
  kind === 'email' ? 'email' : kind === 'phone' ? 'phone number' : 'WhatsApp number';

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

/**
 * Whether the last code has run out, without reading the clock during render.
 *
 * Same shape as the code screen's own hook and the dashboard's: the timer is
 * set for the exact minute the code dies, so a form left open on the photo
 * step for half an hour changes its own words rather than offering a dead
 * code, and nothing calls setState in the effect body.
 */
function useCodeRunOut(sentAt: string | null | undefined): boolean {
  const sentAtMs = sentAt != null ? Date.parse(sentAt) : null;
  const [runOutFor, setRunOutFor] = useState<number | null>(null);
  useEffect(() => {
    if (sentAtMs == null || Number.isNaN(sentAtMs)) {
      return;
    }
    const left = sentAtMs + CODE_TTL_MS - Date.now();
    const timer = setTimeout(() => setRunOutFor(sentAtMs), Math.max(left, 0));
    return () => clearTimeout(timer);
  }, [sentAtMs]);
  return sentAtMs != null && runOutFor === sentAtMs;
}

export default function BusinessSignupScreen() {
  const theme = useTheme();
  // Arriving here is what the flag was for, so put it down. Left up, backing
  // out of this form would land in onboarding and be forwarded straight back,
  // which is a trap rather than a rescue. See features/auth/store.
  const listingDone = useAuthStore((s) => s.listingDone);
  const recordListingIntent = useRecordListingIntent();
  useEffect(() => {
    listingDone();
    // Being on this screen IS the listing intent, so this is the one place
    // that can record it for every route in: the password signup, the Apple
    // one-tap that never reaches submitPassword, and a relaunch straight
    // back into the form. Best effort, because the in-memory flag is already
    // holding the person here and a failed write must not block the listing;
    // it is retried on every mount of this screen, which is every step.
    void recordListingIntent(true).catch(() => {});
  }, [listingDone, recordListingIntent]);

  const userId = useOwnUserId();
  const launchCitiesQuery = useLaunchCities();
  const launchCities = launchCitiesQuery.data ?? [];
  const registerBusiness = useRegisterBusiness();
  const moveBusiness = useUpdateBusinessLocation();
  const requestCode = useRequestBusinessEmailCode();
  // The row, once it exists. Registering happens at the confirm step rather
  // than at the end, because everything after it — photos, hours, links — is
  // an ordinary edit of an existing business, exactly as it will be forever
  // afterwards from the storefront screen. An `unconfirmed` business is fully
  // dark until the code goes in, so building the page while it waits costs
  // nobody anything (docs/BUSINESS_ACCOUNTS.md §3.9).
  const { data: business, refetch: refetchBusiness } = useOwnBusiness();
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
  // See BusinessAddressField's onFocusChange: with the keyboard up there is
  // one field's worth of room left, and the chips and the map were eating it.
  const [addressFocused, setAddressFocused] = useState(false);
  // What the contact step refused, and anything that stopped it saving.
  const [refused, setRefused] = useState<ContactKind[]>([]);
  const [contactProblem, setContactProblem] = useState<string | null>(null);
  const [savingContacts, setSavingContacts] = useState(false);
  const [registered, setRegistered] = useState(false);

  // Chosen, never assumed. This used to fall back to `launchCities[0]`, so
  // somebody who never touched the chips registered in whatever city the query
  // happened to return first — and until 20260829160000 the server did not
  // check either, so a marker in Bangkok could be filed under Lisbon.
  const city = cityId != null ? (launchCities.find((c) => c.city_id === cityId) ?? null) : null;
  const emailOk = EMAIL_PATTERN.test(email.trim());
  const listed = business?.state === 'listed';

  // THE OFFER STEP'S EXAMPLE.
  //
  // A real listing rather than a mock of one: what a traveler actually gets is
  // the whole argument, and the seeded launch venues already are that. The
  // city is whichever one has been picked, or the first we are open in,
  // because at step 3 nobody has picked one yet. Only asked for on the step
  // that draws it, so the other eleven pay nothing for it.
  const exampleCityId = cityId ?? launchCities[0]?.city_id ?? null;
  const exampleCity = launchCities.find((c) => c.city_id === exampleCityId) ?? null;
  const { data: exampleList } = useCityBusinesses(step === 3 ? exampleCityId : null);
  const example = exampleList?.find((row) => row.cover_path != null) ?? exampleList?.[0] ?? null;
  const { data: exampleDetail } = useBusinessDetail(step === 3 ? (example?.id ?? null) : null);

  // THE PHOTOS, owner-scoped.
  //
  // Not `detail?.photos`: business_detail is `security definer` and granted to
  // anon, so it answers approved-only, and with require_photo_moderation ON —
  // which is how production runs — an owner added their cover, watched it chip
  // "In review", and was told by this form that they had none. Widening that
  // RPC would tell any traveler a non-approved photo exists; the owner's own
  // table read, gated by business_photos_select_own, is the safe door.
  const photosQuery = useBusinessPhotos(business?.id ?? null);
  const photos = photosQuery.data ?? [];
  // One picker, driven from both the dashed tile in the grid and the docked
  // button at the bottom of the shell. Run 87 photographed the alternative:
  // two identical "Add photos" buttons adrift on one screen.
  const pickPhoto = useRef<(() => void) | null>(null);
  const registerPick = useCallback((pick: () => void) => {
    pickPhoto.current = pick;
  }, []);

  // Whether the code emailed at the contact step is still a code. Asked only
  // while the listing is waiting on one, and the query stops polling as soon
  // as the answer is in.
  const { data: delivery } = useBusinessCodeStatus(business != null && !listed);
  const codeRunOut = useCodeRunOut(delivery?.sent_at);
  const codeBounced = delivery?.failed === true;
  const codeLive = delivery?.sent_at != null && !codeRunOut && !codeBounced;

  /**
   * The way out, on every step of the form.
   *
   * Steps 4 to 11 had no exit at all and step 3's evaluated to undefined
   * whenever canGoBack was false, which is the NORMAL case here: this screen
   * is reached by a replace. So the only way to abandon a half-finished
   * listing was to kill the app, and killing the app was what lost the
   * in-memory flag and dropped a bar owner into traveler onboarding.
   *
   * A replace to the tabs rather than a guarded back, deliberately: there is
   * usually nothing behind this screen, and the tabs are the one destination
   * that always exists. That is why this file is exempt from the
   * canGoBack rule the other replace-to-tabs screens follow; see
   * app/__tests__/business-exits.test.ts, which writes the reason down.
   */
  const leaveFooter = (
    <PrimaryButton
      variant="ghost"
      label="Finish this later"
      onPress={() => router.replace('/(tabs)')}
    />
  );

  const go = (next: number) => {
    haptics.light();
    setTouched(false);
    if (next > step) {
      analytics.capture('business_step_completed', {
        step_index: step,
        step_name: businessStepName(step),
      });
    }
    setStep(next);
  };

  /** A fresh code, for an owner whose first one died while they worked. */
  const resendCode = () => {
    if (!emailOk) {
      return;
    }
    void requestCode.mutateAsync(email.trim()).catch(() => {});
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
    // Already registered, so this is a correction rather than a creation:
    // somebody walked back to "Where is it?" from a later step. lat, lng and
    // city_id have no client UPDATE grant, so the move goes through the
    // SECURITY DEFINER door, which re-runs the same city radius check.
    if (registered || business != null) {
      try {
        await moveBusiness.mutateAsync({
          lat: coords.lat,
          lng: coords.lng,
          cityId: city.city_id,
          address: address.trim() || null,
          clearAddress: address.trim().length === 0,
        });
      } catch {
        // Surfaced by the global mutation error alert; stay on the step so
        // the marker can be dragged back inside the city.
        return;
      }
      go(7);
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
      go(7);
    } catch {
      // Surfaced by the global mutation error alert (lib/query-client). Three
      // refusals arrive this way: an account that has already finished a
      // traveler profile, a city we have not launched in, and — new since
      // 20260829160000, and previously claimed here but never true — a marker
      // outside the city's radius.
    }
  };

  /**
   * The contact rows, set to exactly what is in the fields.
   *
   * Three things this had wrong, all of them invisible from a single pass:
   * it appended rather than replaced, so a correction left two emails on the
   * public page; it swallowed a refusal, so a number the validator would not
   * take just disappeared; and it returned silently when the business query
   * had not landed yet, so Continue did nothing at all with no spinner and no
   * word of explanation.
   */
  const saveContacts = async () => {
    setTouched(true);
    setRefused([]);
    if (!emailOk) {
      return;
    }
    // Registering invalidates this query and the refetch is not instant, so
    // arriving here in the same breath as step 6 can find it empty. Wait for
    // it rather than doing nothing: the button shows its spinner meanwhile.
    let businessId = business?.id ?? null;
    if (businessId == null) {
      setSavingContacts(true);
      try {
        const fresh = await refetchBusiness();
        businessId = fresh.data?.id ?? null;
      } catch {
        businessId = null;
      }
    }
    if (businessId == null) {
      setSavingContacts(false);
      setContactProblem('We could not reach your listing just then. Try that again.');
      return;
    }
    setSavingContacts(true);
    setContactProblem(null);
    try {
      const rejected = await replaceBusinessContacts({
        businessId,
        email,
        phone,
        whatsapp,
      });
      if (rejected.length > 0) {
        // Named rather than dropped. Still not fatal — everything here is
        // editable from the business page — but somebody who typed a number
        // deserves to know it did not take.
        setRefused(rejected);
        return;
      }
      // The code, emailed the moment there is an address to email it to,
      // rather than nine screens later. Deliberately not awaited into the
      // Continue path: a mail failure must not hold up the form, and the
      // footer on every step from here on, plus the code screen at the end,
      // both surface a bounce through useBusinessCodeStatus.
      //
      // Guarded exactly as sendCode() is, and for the reason written there:
      // a second code inside the first one's twenty minutes spends one of the
      // five a business gets in a day AND invalidates the digits somebody may
      // be holding in their other hand. This step is not a one-way door -
      // Continue, back one screen, Continue again is an ordinary thing to do
      // while checking a phone number - so an unguarded send here burned a
      // daily allowance per back-navigation and silently killed the code
      // already in the owner's inbox. A bounce is skipped from the same end:
      // re-sending to an address that just bounced only bounces again, and
      // the code screen leads with "Use a different address".
      if (!codeLive && !codeBounced) {
        void requestCode.mutateAsync(email.trim()).catch(() => {});
      }
      go(8);
    } catch {
      setContactProblem('We could not save those just then. Try that again.');
    } finally {
      setSavingContacts(false);
    }
  };

  /**
   * What the review step's button says and what the note under it promises.
   *
   * Both used to be fixed: "Email me a code" over "Almost there. We'll email
   * you a code." Since biz-email-lands-early the code has ALREADY gone out
   * from the contact step, and sendCode() below opens the code screen without
   * sending when one is still live - so the normal path had three statements
   * on one screen, two of them false: a footer saying a code had been sent
   * and offering a box to type it in, a note promising one in the future, and
   * a button offering to send a thing it was not going to send.
   *
   * Each branch is a state the owner can actually be in, and says the true
   * thing about it.
   */
  const reviewAction = listed
    ? {
        label: 'You are on the map',
        note: 'Every part of this is editable from your business page afterwards.',
      }
    : codeBounced
      ? {
          label: 'Use a different address',
          note: 'That address did not take the mail. Try another one and we will send it again.',
        }
      : codeLive
        ? {
            label: 'Type in your code',
            note: "We've emailed you a code. Type it in and you're on the map.",
          }
        : delivery?.sent_at != null
          ? {
              label: 'Email me a new code',
              note: 'That code has run out. We will send a fresh one.',
            }
          : { label: 'Email me a code', note: EMAIL_PROMISE };

  /** The last thing this form does. The code screen takes it from here. */
  const sendCode = async () => {
    if (!emailOk) {
      return;
    }
    // Replace rather than push: the form has been submitted, and a back
    // swipe onto it would offer to submit it a second time.
    //
    // The address travels WITH the route. Without it the code screen cannot
    // name where the mail went and cannot offer to send it again, so a typo
    // or a code lost to a spam folder ended the whole journey: the listing
    // sits unconfirmed, which means dark, with no way forward from inside
    // the app.
    const openCodeScreen = () =>
      router.replace({ pathname: '/business-email', params: { email: email.trim() } });
    // A code has already gone out from the contact step. Sending a second one
    // inside its own twenty minutes spends one of the five a business gets in
    // a day AND invalidates the digits somebody may be holding in their other
    // hand. A bounce is skipped from the other end, for the same economy: the
    // code screen leads with "Use a different address", and re-sending to the
    // address that just bounced would only bounce again.
    if (codeLive || codeBounced) {
      openCodeScreen();
      return;
    }
    try {
      await requestCode.mutateAsync(email.trim());
      haptics.success();
      openCodeScreen();
    } catch {
      // Surfaced by the global mutation error alert. The refusal that matters
      // is the fifth code of the day.
    }
  };

  /**
   * The footer from the photo step onwards: type the code without leaving.
   *
   * The mail may well arrive while somebody is still cropping photos, and
   * before this the only way to use it was to finish every remaining screen
   * first. It is deliberately NOT a link to /business-email: that screen ends
   * with `router.replace('/(tabs)')`, which would drop a mid-signup owner out
   * of the flow with an unfinished listing behind them.
   */
  const listingFooter = (
    <>
      <ConfirmEmailFooter
        listed={listed}
        codeRunOut={codeRunOut}
        bounced={codeBounced}
        onResend={resendCode}
        resending={requestCode.isPending}
      />
      {leaveFooter}
    </>
  );

  if (step === 3) {
    return (
      <StepShell
        step={3}
        total={BUSINESS_TOTAL_STEPS}
        footer={leaveFooter}
        title="What a listing gets you"
        subtitle="Travelers tap your marker on the map and land on a page like this one."
        onBack={router.canGoBack() ? () => router.back() : undefined}
        continueTestID="business-offer-continue"
        // No skip. It is one tap, and it is the offer: every screen after
        // this one assumes the question it answers has been answered.
        onContinue={() => go(4)}>
        {example ? (
          <>
            <ThemedText type="footnote" themeColor="textSecondary">
              Somebody else&apos;s listing, as a traveler meets it.
            </ThemedText>
            <ListingPreview
              detail={exampleDetail ?? null}
              fallbackName={example.name}
              category={example.category}
              cityName={exampleCity?.cities.name ?? null}
            />
          </>
        ) : null}
        <ThemedText>
          A listing puts your business on the map, with your photos, your hours and a way for
          travelers to write to you.
        </ThemedText>
        {/* The word "free" appeared nowhere an owner could read it: a grep
            across src/ returned two traveler-facing screens and nothing else,
            while §7 rule 1 makes the whole app permanently free. A hostel
            manager handed a flyer had no way to find that out. */}
        <ThemedText>Free, always. No paid placement, no promoted listings.</ThemedText>
      </StepShell>
    );
  }

  if (step === 4) {
    return (
      <StepShell
        step={4}
        total={BUSINESS_TOTAL_STEPS}
        footer={leaveFooter}
        title="What's your business called?"
        subtitle="The name over the door, and what kind of business it is."
        note={category == null ? 'Pick what kind of business it is.' : null}
        onBack={() => go(3)}
        continueTestID="business-name-continue"
        // Pressable while incomplete on purpose, exactly like the traveler
        // steps: pressing is what marks the field touched, and that is what
        // shows somebody WHY it will not go through.
        onContinue={() => {
          setTouched(true);
          if (nameProblem(name) != null || category == null) {
            return;
          }
          go(5);
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

  if (step === 5) {
    return (
      <StepShell
        step={5}
        total={BUSINESS_TOTAL_STEPS}
        title="Where is it?"
        subtitle="Type your address, then check the marker is on your door."
        // Greyed while the answer is missing, like every other blocked step.
        // It rendered full accent blue and swallowed the tap silently; the
        // note alone carried "pick your city", and only before a city was
        // picked. The grey button now says "not yet" the whole way.
        continueDisabled={city == null || coords == null}
        note={
          addressFocused
            ? 'Pick your street from the list.'
            : city != null && coords == null
              ? 'Pick your street above, or tap the map on your door.'
              : null
        }
        onBack={() => go(4)}
        continueTestID="business-place-continue"
        onContinue={() => {
          setTouched(true);
          if (coords == null || city == null) {
            return;
          }
          // Forward to the confirm step. This said go(3) and sent an owner
          // back to the name screen instead, which is a loop with no way out
          // of the form: the founder's "Is this right?" was unreachable.
          go(6);
        }}
        footer={
          <>
            {launchCitiesQuery.isError ? (
              <PrimaryButton
                variant="ghost"
                label="Try again"
                onPress={() => launchCitiesQuery.refetch()}
              />
            ) : null}
            {leaveFooter}
          </>
        }>
        {launchCities.length > 0 && !addressFocused ? (
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
            {/* The door for city five. A hostel in Porto used to hit a wall
                here, quit, and the app never learned it existed - exactly the
                demand signal that picks the next launch city. /contact
                carries it with zero schema. */}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Somewhere else? Tell us where."
              haptic="light"
              scaleTo={0.98}
              onPress={() => router.push('/contact')}
              style={styles.elsewhere}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Somewhere else? Tell us where.
              </ThemedText>
            </PressableScale>
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
              onFocusChange={setAddressFocused}
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
            {addressFocused ? null : (
              <>
                <LocationPicker
                  // Remounted on a city change: the picker reads its centre
                  // once, through initialRegion, so without this the map keeps
                  // showing the city that was chosen first.
                  key={city.city_id}
                  // Once the address geocodes, the map flies to it at street
                  // level: "check the marker is on your door" cannot be
                  // answered by seven kilometres of city. With nothing
                  // geocoded it stays on the city at city scale.
                  centerLat={coords?.lat ?? city.cities.lat}
                  centerLng={coords?.lng ?? city.cities.lng}
                  delta={coords != null ? 0.004 : 0.06}
                  lat={coords?.lat ?? city.cities.lat}
                  lng={coords?.lng ?? city.cities.lng}
                  // No marker until there is one to draw. It used to sit on
                  // the city centre, so the screen showed a marker, refused
                  // Continue, and asked for a marker.
                  placed={coords != null}
                  // The chip a traveler will actually tap, not MapKit's red
                  // balloon. Category is picked a step before this map.
                  marker={category ? <PlaceGlyph category={category} /> : undefined}
                  // Only the marker. The address stays exactly as typed, which
                  // is the founder's rule and the reason these are two fields.
                  onChange={(lat, lng) => setCoords({ lat, lng })}
                />
                {address.trim().length > 0 && coords != null ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Move the marker as much as you like. Your address stays as you wrote it.
                  </ThemedText>
                ) : null}
              </>
            )}
          </>
        ) : (
          <ThemedText themeColor="textSecondary">
            {launchCitiesQuery.isError
              ? 'The map could not load the cities. Check your connection and try again.'
              : launchCities.length > 0
                ? // The launch state, said plainly, and derived from the list
                  // so it stays true when city five lands. Nothing is loading
                  // here: the screen is waiting on a tap.
                  `We're in ${cityCountWord(launchCities.length)} so far. Pick yours above and the map shows up.`
                : 'Getting the cities.'}
          </ThemedText>
        )}
      </StepShell>
    );
  }

  if (step === 6) {
    return (
      <StepShell
        step={6}
        total={BUSINESS_TOTAL_STEPS}
        footer={leaveFooter}
        title="Is this right?"
        subtitle="This is what a traveler sees when they tap you on the map."
        continueLabel="Yes, that's us"
        onBack={() => go(5)}
        continueTestID="business-confirm-place"
        continueLoading={registerBusiness.isPending || moveBusiness.isPending}
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
            // Street level, not city level. The question this step asks is
            // whether the marker is on the door, and the city-wide default
            // cannot answer it.
            delta={0.004}
            // "Is this right?" previews the chip a traveler sees, not a red
            // balloon they never will.
            marker={category ? <PlaceGlyph category={category} /> : undefined}
            onChange={(lat, lng) => setCoords({ lat, lng })}
          />
        ) : null}
        <PrimaryButton variant="ghost" label="Fix the address" onPress={() => go(5)} />
        {/* A small nudge onto the real door costs nothing since
            20260902100000: only a city change or a move over seventy-five
            metres sends a listed business back for another email check. */}
        <ThemedText type="footnote" themeColor="textSecondary">
          Both of these are yours to change later. Moving the marker to another street after you go
          live sends the listing back for another email check, so it is worth getting right now.
        </ThemedText>
      </StepShell>
    );
  }

  if (step === 7) {
    return (
      <StepShell
        step={7}
        total={BUSINESS_TOTAL_STEPS}
        footer={leaveFooter}
        title="How do people reach you?"
        subtitle="The email is the one we need. The rest is up to you."
        continueTestID="business-contact-continue"
        continueLoading={savingContacts}
        note={
          contactProblem ??
          (refused.length > 0
            ? `We could not save your ${refused.map(CONTACT_LABEL).join(' or ')}. Check the format, or clear it and carry on.`
            : null)
        }
        onBack={() => go(6)}
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
          error={
            refused.includes('email')
              ? 'That address did not take.'
              : touched && !emailOk
                ? 'That address looks off. Check it over.'
                : null
          }
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
          {/* Capped where the database caps it. Run 84 photographed a phone
              field holding 33 characters, which is past the 30 the validator
              takes, and nothing said so until Continue refused it. A limit
              you cannot exceed beats an error you meet afterwards. */}
          <FormTextField
            label="Phone"
            testID="business-phone-input"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            placeholder="+351 912 345 678"
            maxLength={CONTACT_MAX}
            value={phone}
            onChangeText={setPhone}
            error={refused.includes('phone') ? 'That number did not take.' : null}
            {...keyboardDoneProps}
          />
          <FormTextField
            label="WhatsApp"
            testID="business-whatsapp-input"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
            placeholder="Same number, or a different one"
            maxLength={CONTACT_MAX}
            value={whatsapp}
            onChangeText={setWhatsapp}
            error={refused.includes('whatsapp') ? 'That number did not take.' : null}
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
  // the confusion the founder hit. The photo step now owns the real grid
  // rather than routing into the middle of the settings form; the other three
  // still hand over to the editor that owns them.

  if (step === 8) {
    // Anything not yet refused counts. A pending photo is a photo: the owner
    // can see it, the worker will very likely clear it, and holding the wall
    // shut until it does told somebody with a cover on screen that they had
    // none. A rejection is the one state that does not count, and it is the
    // one state this step can name a reason for.
    const usable = photos.some((photo) => photo.moderation_status !== 'rejected');
    const pending = photos.some((photo) => photo.moderation_status === 'pending');
    const allRejected = photos.length > 0 && !usable;
    return (
      <StepShell
        step={8}
        total={BUSINESS_TOTAL_STEPS}
        footer={listingFooter}
        title="Show your business"
        subtitle="Photos of the business, not of a person. The first one that clears is your cover, and it is the thing travelers see on the map."
        // The docked button drives the SAME picker as the dashed tile while
        // there is nothing to continue past, and turns into Continue the
        // moment a photo lands. Never a greyed Continue: opacity cannot
        // express "unavailable" and stay legible (skills/traps), and a button
        // that changes job says more than one that dims.
        continueLabel={usable ? 'Continue' : 'Add photos'}
        continueTestID="business-photos-continue"
        note={
          allRejected
            ? "That one didn't pass. Try another, of the business rather than a person."
            : pending
              ? // The dashboard's own sentence, word for word, because it is
                // the same wait and two wordings of it read as two states.
                "We're having a look at your photos. This usually takes a minute."
              : photos.length > 0
                ? CHANGE_LATER
                : 'One photo is the only thing we need here.'
        }
        onBack={() => go(7)}
        onContinue={() => (usable ? go(9) : pickPhoto.current?.())}>
        {business ? (
          <BusinessPhotos businessId={business.id} userId={userId} registerPick={registerPick} />
        ) : null}
      </StepShell>
    );
  }

  if (step === 9) {
    return (
      <StepShell
        step={9}
        total={BUSINESS_TOTAL_STEPS}
        footer={listingFooter}
        title="What is it like?"
        subtitle="A couple of lines a traveler would actually want to read. Not a menu, not an advert."
        continueTestID="business-description-continue"
        // Says what the press does. With nothing written yet the button
        // opens the editor rather than moving on, and calling that
        // "Continue" is the same lie step 8 already stopped telling.
        continueLabel={detail?.description ? 'Continue' : 'Write it'}
        note={CHANGE_LATER}
        onBack={() => go(8)}
        onSkip={() => go(10)}
        onContinue={() =>
          detail?.description
            ? go(10)
            : router.push({ pathname: '/business-edit', params: { section: 'details' } })
        }>
        {/* The card and the ghost button only once there is something to
            show and something to change. Empty, this step drew a "Write it"
            ghost directly above a docked button that did the same thing. */}
        {detail?.description ? (
          <>
            <View style={[styles.confirmCard, { backgroundColor: theme.surfaceSunken }]}>
              <ThemedText>{detail.description}</ThemedText>
            </View>
            <PrimaryButton
              variant="ghost"
              label="Change it"
              onPress={() =>
                router.push({ pathname: '/business-edit', params: { section: 'details' } })
              }
            />
          </>
        ) : null}
      </StepShell>
    );
  }

  if (step === 10) {
    const hourCount = detail?.hours?.length ?? 0;
    return (
      <StepShell
        step={10}
        total={BUSINESS_TOTAL_STEPS}
        footer={listingFooter}
        title="When are you open?"
        subtitle="Past midnight is fine. 20:00 to 2:00 reads as one night."
        continueTestID="business-hours-continue"
        continueLabel={hourCount > 0 ? 'Continue' : 'Set your hours'}
        note={CHANGE_LATER}
        onBack={() => go(9)}
        onSkip={hourCount > 0 ? undefined : () => go(11)}
        onContinue={() =>
          hourCount > 0
            ? go(11)
            : router.push({ pathname: '/business-edit', params: { section: 'hours' } })
        }>
        {/* Only once there is something to change. With no hours set this was
            a ghost "Set your hours" above a docked button that opened the
            same editor, which is the pair run 87 caught on the photos step. */}
        {hourCount > 0 ? (
          <PrimaryButton
            variant="ghost"
            label="Change your hours"
            onPress={() =>
              router.push({ pathname: '/business-edit', params: { section: 'hours' } })
            }
          />
        ) : null}
        <ThemedText type="footnote" themeColor="textSecondary">
          No hours is better than wrong hours. Somebody standing outside a closed door because your
          page said otherwise is worse than not knowing.
        </ThemedText>
      </StepShell>
    );
  }

  if (step === 11) {
    const linkCount = detail?.links?.length ?? 0;
    return (
      <StepShell
        step={11}
        total={BUSINESS_TOTAL_STEPS}
        footer={listingFooter}
        title="Anywhere else to send people?"
        subtitle="A menu, a booking page, your Instagram. One list for links, socials and contact."
        continueTestID="business-links-continue"
        // Continue and Skip for now both went to the review step, so the
        // docked button and the quiet one under it were the same control
        // wearing two words. Now the button adds a link until there is one to
        // add to.
        continueLabel={linkCount > 0 ? 'Continue' : 'Add a link'}
        note={CHANGE_LATER}
        onBack={() => go(10)}
        onSkip={() => go(12)}
        onContinue={() =>
          linkCount > 0
            ? go(12)
            : router.push({ pathname: '/business-edit', params: { section: 'links' } })
        }>
        {linkCount > 0 ? (
          <PrimaryButton
            variant="ghost"
            label={`${linkCount} on your page. Add more`}
            onPress={() =>
              router.push({ pathname: '/business-edit', params: { section: 'links' } })
            }
          />
        ) : null}
      </StepShell>
    );
  }

  // THE REVIEW, WHICH IS ALSO THE SEND.
  //
  // These were two screens: "Here it is" and then "One last thing", the
  // second of which was a headline, an address in a card and a button. It
  // also made the bar read 12 of 12 with the code screen still to come. The
  // card and the ghost moved up under the listing, and the screen the flow
  // ends on is the one that turns the lights on.
  return (
    <StepShell
      step={12}
      total={BUSINESS_TOTAL_STEPS}
      footer={listingFooter}
      title="Here it is"
      subtitle="Exactly what a traveler sees when they tap you. Step back to change anything."
      continueLabel={reviewAction.label}
      continueTestID="business-review-continue"
      continueLoading={requestCode.isPending}
      note={reviewAction.note}
      onBack={() => go(11)}
      onContinue={() => (listed ? router.replace('/(tabs)') : void sendCode())}>
      {/* The listing, not a receipt for it.

          This used to be a text card ending in "1 photo · 0 links · no
          hours yet", which is a form's summary of itself. The founder asked
          for "a final look of how your profile appears to other users", and
          a traveler never sees a count — they see the cover photo first,
          then the name, then whether you are open. So: the cover, at the
          size the map card gives it, and the real words underneath. */}
      <ListingPreview
        detail={detail ?? null}
        fallbackName={name.trim()}
        category={category}
        cityName={city?.cities.name ?? null}
        // The heading promises what a traveler sees. While the listing is
        // unconfirmed no traveler sees any of it, so the promise is qualified
        // on the screen that makes it rather than one screen later.
        badge={listed ? null : 'Not on the map yet'}
      />
      {listed ? null : (
        <>
          <View style={[styles.confirmCard, { backgroundColor: theme.surfaceSunken }]}>
            {/* Title case, matching the app-wide retirement of all-caps labels
                (DESIGN.md). */}
            <ThemedText type="caption" themeColor="textSecondary">
              Sending it to
            </ThemedText>
            <ThemedText type="headline">{email.trim()}</ThemedText>
          </View>
          <PrimaryButton variant="ghost" label="Use a different address" onPress={() => go(7)} />
        </>
      )}
    </StepShell>
  );
}

/**
 * Type the emailed code without leaving the form.
 *
 * The code goes out at the contact step now, so it usually lands while
 * somebody is still cropping photos. Before this the only way to use it was
 * to finish every remaining screen first, and the code is good for twenty
 * minutes.
 *
 * It confirms INLINE and navigates nowhere. Pushing /business-email would be
 * the obvious shortcut and it is the wrong one: that screen ends with
 * `router.replace('/(tabs)')`, so a mid-signup owner would be dropped out of
 * the flow with an unfinished listing behind them.
 *
 * On success `business.state` flips to 'listed' underneath a mounted
 * StepShell. useOwnBusiness holds its row for five minutes, so what makes the
 * screen notice is the confirm mutation's existing invalidation of
 * ['my-business', userId] — an active observer refetches on invalidate, which
 * is why this needs no state of its own beyond the six digits.
 */
function ConfirmEmailFooter({
  listed,
  codeRunOut,
  bounced,
  onResend,
  resending,
}: {
  listed: boolean;
  codeRunOut: boolean;
  bounced: boolean;
  onResend: () => void;
  resending: boolean;
}) {
  const confirm = useConfirmBusinessEmail();
  const [code, setCode] = useState('');

  const submit = async () => {
    if (code.length !== CODE_LENGTH) {
      return;
    }
    try {
      const result = await confirm.mutateAsync(code);
      analytics.capture('business_email_confirmed', { first_time: result.first_time });
      haptics.success();
      setCode('');
    } catch {
      // The global mutation alert carries the database's own words ("that
      // code is not right", "that code has expired"). Empty the box, because
      // the next attempt is six fresh digits rather than an edit of these.
      haptics.error();
      setCode('');
    }
  };

  if (listed) {
    return (
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.footerLine}>
        You are on the map.
      </ThemedText>
    );
  }

  return (
    <View style={styles.block}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {bounced
          ? 'That address bounced, so the code never arrived. You can fix the address on the last screen.'
          : codeRunOut
            ? 'The code we emailed you has run out. Send yourself a fresh one.'
            : 'We emailed you a six-digit code. Type it in here whenever it turns up.'}
      </ThemedText>
      <FormTextField
        label="Code"
        testID="business-inline-code"
        accessibilityLabel="Six-digit code"
        keyboardType="number-pad"
        // number-pad draws no return key at all on iOS, so the accessory bar
        // is the only way off this keyboard (skills/traps).
        maxLength={CODE_LENGTH}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        // Paste from a mail app arrives with whatever was around it.
        onChangeText={(next) => setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        {...keyboardDoneProps}
      />
      <PrimaryButton
        variant="ghost"
        label="Confirm your email"
        accessibilityLabel="Confirm your email with this code"
        disabled={code.length !== CODE_LENGTH}
        loading={confirm.isPending}
        onPress={submit}
      />
      {/* Only once the last one is dead. A business gets five codes a day and
          a freely pressable resend on five consecutive screens would burn
          them in a minute, so the run-out timer is what unlocks this. */}
      {codeRunOut && !bounced ? (
        <PrimaryButton
          variant="ghost"
          label="Send a fresh code"
          accessibilityLabel="Send a fresh code"
          loading={resending}
          onPress={onResend}
        />
      ) : null}
    </View>
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

/**
 * The listing as a traveler meets it, at the end of building one.
 *
 * The founder's rule for both kinds of profile: "It should also give you a
 * final look of how your profile appears to other users at the end of
 * onboarding." A person gets ProfileView, the same component a stranger gets.
 * A business used to get a text card whose last line was "1 photo · 0 links ·
 * no hours yet", which is a form describing itself.
 *
 * Not PlaceCard, though it is the real traveler view: that one carries
 * Message, Rate and Report, all of which act on a business, and this one is
 * still `unconfirmed` — dark, unlisted, unmessageable. Offering three buttons
 * that cannot work is worse than not offering them. So this draws the same
 * things in the same order, and nothing that does anything.
 *
 * The photo it draws stays `detail.photos[0]`, which business_detail has
 * already filtered to approved. That is the one place in this file where the
 * approved-only read is the RIGHT one: this preview is honestly showing what
 * a traveler gets, and a traveler gets nothing until the check clears.
 */
function ListingPreview({
  detail,
  fallbackName,
  category,
  cityName,
  badge,
}: {
  detail: BusinessDetailRow | null;
  fallbackName: string;
  category: BusinessCategory | null;
  cityName: string | null;
  badge?: string | null;
}) {
  const theme = useTheme();
  const { data: cover } = useBusinessPhotoUrl(detail?.photos?.[0]?.storage_path ?? null);
  // The place's own clock, not the reader's — the same call the map card
  // makes, so the two cannot disagree about whether somebody is open.
  const open = detail ? openLine(detail.hours, new Date(), detail.lng) : null;
  const extraPhotos = Math.max((detail?.photos?.length ?? 0) - 1, 0);

  return (
    <View style={[styles.preview, { backgroundColor: theme.surfaceSunken }]}>
      {cover ? (
        <Image source={{ uri: cover }} style={styles.previewCover} contentFit="cover" />
      ) : (
        <View style={[styles.previewCover, styles.previewCoverEmpty]}>
          <ThemedText type="footnote" themeColor="textSecondary">
            No photo yet
          </ThemedText>
        </View>
      )}
      <View style={styles.previewBody}>
        {badge ? (
          <View style={[styles.previewBadge, { backgroundColor: theme.surface }]}>
            <ThemedText type="caption" themeColor="warning">
              {badge}
            </ThemedText>
          </View>
        ) : null}
        <ThemedText type="headline">{detail?.name ?? fallbackName}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {category ? CATEGORY_LABEL[category] : ''}
          {cityName ? ` · ${cityName}` : ''}
        </ThemedText>
        {open ? <ThemedText type="footnote">{open}</ThemedText> : null}
        {detail?.address ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {detail.address}
          </ThemedText>
        ) : null}
        {detail?.description ? <ThemedText>{detail.description}</ThemedText> : null}
        {(detail?.links?.length ?? 0) > 0 ? (
          <View style={styles.previewChips}>
            {detail?.links.map((link) => (
              <View
                key={`${link.kind}:${link.value}`}
                style={[styles.previewChip, { backgroundColor: theme.surface }]}>
                <ThemedText type="footnote">{link.label}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}
        {extraPhotos > 0 ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {countOf(extraPhotos, 'more photo')} on your page.
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  previewCover: {
    width: '100%',
    height: 180,
  },
  previewCoverEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBody: {
    padding: Space.md,
    gap: Space.xs,
  },
  previewBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  previewChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.xs,
    marginTop: 2,
  },
  previewChip: {
    paddingHorizontal: Space.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  block: {
    gap: Space.sm,
  },
  footerLine: {
    textAlign: 'center',
  },
  // A quiet full-height row: 44pt to tap, footnote-sized to read.
  elsewhere: {
    minHeight: HitTarget,
    justifyContent: 'center',
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
