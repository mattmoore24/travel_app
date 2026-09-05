import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
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
  useCityForSpot,
  useConfirmBusinessEmail,
  useOwnBusiness,
  useRecordListingIntent,
  useRegisterBusiness,
  useRequestBusinessEmailCode,
  useUpdateBusinessLocation,
  useUpdateOwnBusiness,
} from '@/features/business/hooks';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  LINK_LABEL,
  openLine,
  weekdayLabel,
} from '@/features/business/vocabulary';
import { countOf } from '@/lib/plural';
import { cityInZone, deviceTimezone } from '@/features/pins/browsing-city';
import { useCity, useFeaturedCities, useLaunchCities } from '@/features/pins/hooks';
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
 * Where the set-the-pin map opens when nothing better is known: the whole
 * world, for somebody to pinch into. Reached only when the search had no
 * near miss to offer and no featured city shares the phone's clock zone.
 */
const WORLD_START = { lat: 20, lng: 0, delta: 120 };

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
/** businesses.description is capped at 600 in the column CHECK. */
const DESCRIPTION_MAX = 600;
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
  // The launch list decides one thing on this form now: which city's real
  // listing the offer step shows as its example. Where a business may BE is
  // any city, since 2026-09-05, and the server names it from the marker.
  const launchCities = useLaunchCities().data ?? [];
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
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // The by-hand path on "Where is it?": the small line was tapped, so the
  // map is shown with no marker, waiting for one, starting where the search
  // almost found the address, else the featured city on this phone's clock
  // zone, else the world. Screen-level, so walking back keeps it.
  const [pinYourself, setPinYourself] = useState(false);
  const [mapStart, setMapStart] = useState<{ lat: number; lng: number; delta: number } | null>(
    null
  );
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
  /**
   * The address the last code ACTUALLY went to, or null.
   *
   * my_business_code_status (20260829150000:173-198) returns sent_at,
   * delivered, attempts and failed - and no address. So `codeLive` means "a
   * code is live", never "a code is live FOR THIS ADDRESS", and a guard built
   * on it alone cannot tell a second Continue on the same address from a
   * corrected typo. This is the missing half, and it fails SAFE: when it is
   * stale or reset the send happens, which is the old behaviour. Only a send
   * that actually resolved advances it, so a refusal (the fifth of the day)
   * cannot leave a live-looking record of a code nobody got.
   */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  /**
   * The description, edited on its own step rather than in the settings form.
   *
   * Null means "nothing typed yet", and the field falls through to the saved
   * row — which is what makes the step correct on the way BACK to it as well
   * as the first time. A plain string seeded at mount would have been seeded
   * from a row that had not landed, and an effect that reseeds it would fight
   * whatever is being typed. The first keystroke makes it a string and it
   * owns the value from then on, so an empty field stays empty and a draft
   * somebody skipped past is still there when they come back.
   */
  const [description, setDescription] = useState<string | null>(null);
  const [savingDescription, setSavingDescription] = useState(false);
  const [descriptionProblem, setDescriptionProblem] = useState<string | null>(null);
  const updateBusiness = useUpdateOwnBusiness(business?.id ?? null);

  // The city is the SERVER'S answer, never a choice made here: the same
  // resolver register_business runs, asked ahead of the write so the screen
  // can say "That puts you in Lisbon, Portugal." and the confirm card can
  // name it. The stored city is the hint on a re-entry; null the first time.
  const { data: spotCity = null } = useCityForSpot(coords, business?.city_id ?? null);
  // The row behind it, for a re-entry that has no marker in state yet.
  const { data: businessCityRow = null } = useCity(business?.city_id ?? null);
  // Where the by-hand map opens with nothing better to go on: Intl only,
  // never a location read (section 7 rule 2).
  const { data: featured = [] } = useFeaturedCities();
  const zoneCity = cityInZone(featured, deviceTimezone());
  const emailOk = EMAIL_PATTERN.test(email.trim());
  const listed = business?.state === 'listed';

  // THE OFFER STEP'S EXAMPLE.
  //
  // A real listing rather than a mock of one: what a traveler actually gets is
  // the whole argument, and the seeded launch venues already are that. The
  // first city we are open in, because nothing on this form picks one any
  // more. Only asked for on the step that draws it, so the other eleven pay
  // nothing for it.
  const exampleCityId = launchCities[0]?.city_id ?? null;
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
    if (category == null || coords == null) {
      return;
    }
    // Already registered, so this is a correction rather than a creation:
    // somebody walked back to "Where is it?" from a later step. lat, lng and
    // city_id have no client UPDATE grant, so the move goes through the
    // SECURITY DEFINER door, which files the listing under the city the
    // marker is in (the stored city is its hint).
    if (registered || business != null) {
      try {
        await moveBusiness.mutateAsync({
          lat: coords.lat,
          lng: coords.lng,
          address: address.trim() || null,
          clearAddress: address.trim().length === 0,
        });
      } catch {
        // Surfaced by the global mutation error alert; stay on the step.
        return;
      }
      go(7);
      return;
    }
    try {
      await registerBusiness.mutateAsync({
        name: name.trim(),
        category,
        lat: coords.lat,
        lng: coords.lng,
        address: address.trim() || null,
      });
      setRegistered(true);
      // The city the preview resolved, when it has answered: the server's
      // own answer is the same function with the same hint. Null on a slow
      // network is the honest value, and nothing awaited on it before.
      analytics.capture('business_registered', { category, city_id: spotCity?.id ?? null });
      go(7);
    } catch {
      // Surfaced by the global mutation error alert (lib/query-client). Two
      // refusals arrive this way: an account that has already finished a
      // traveler profile, and a second business on one account. Geography
      // is not one of them any more (20260905130000).
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
      // Guarded as sendCode() is, and for the reason written there: a second
      // code inside the first one's twenty minutes spends one of the five a
      // business gets in a day AND invalidates the digits somebody may be
      // holding in their other hand. This step is not a one-way door -
      // Continue, back one screen, Continue again is an ordinary thing to do
      // while checking a phone number - so an unguarded send burned an
      // allowance per back-navigation and killed the live code.
      //
      // But SCOPED TO THE ADDRESS, which sendCode does not have to be and
      // this does. The commonest reason to come back to this step is that the
      // email was wrong, and codeLive cannot see an address (the status RPC
      // does not return one), so guarding on it alone skipped the send for a
      // CORRECTED address and left the owner with a listing whose code went
      // to the typo - stuck, with no way to ask for one that was never sent.
      // That is a worse failure than the one the guard is for, so the guard
      // only bites when the live-or-bounced code belongs to this same
      // address. A bounce is scoped the same way: re-sending to the address
      // that just bounced bounces again, but a different address is exactly
      // the fix for it.
      const target = email.trim();
      if (sentTo !== target || !(codeLive || codeBounced)) {
        void requestCode
          .mutateAsync(target)
          // Only a send that resolved counts. A refusal must not record an
          // address as covered, or the next pass would skip it too.
          .then(() => setSentTo(target))
          .catch(() => {});
      }
      go(8);
    } catch {
      setContactProblem('We could not save those just then. Try that again.');
    } finally {
      setSavingContacts(false);
    }
  };

  /**
   * The description, saved on its own step. No handoff to the editor at all.
   *
   * `useUpdateOwnBusiness` is the mutation that owns this column and already
   * invalidates the row, the traveler-facing detail and the map list, so the
   * review step two screens later shows the words that were just typed.
   */
  const descriptionText = description ?? business?.description ?? '';
  const descriptionError =
    descriptionText.length > DESCRIPTION_MAX
      ? `That is ${descriptionText.length - DESCRIPTION_MAX} characters too long.`
      : null;

  const saveDescription = async () => {
    const trimmed = descriptionText.trim();
    if (descriptionError != null) {
      return;
    }
    // Nothing to write, so nothing to wait for. Also the path taken when the
    // step is passed through untouched, which is most of them.
    if (business == null || trimmed === (business.description ?? '')) {
      go(10);
      return;
    }
    setSavingDescription(true);
    setDescriptionProblem(null);
    try {
      await updateBusiness.mutateAsync({ description: trimmed || null });
      go(10);
    } catch {
      // Stay on the step. What was typed is the only copy of it, and moving
      // on would leave somebody believing it had saved.
      setDescriptionProblem('We could not save that just then. Try again.');
    } finally {
      setSavingDescription(false);
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
        footer={leaveFooter}
        title="Where is it?"
        subtitle="Type your address and tap it when it comes up."
        // Greyed while the marker is missing, like every other blocked step:
        // the grey button says "not yet" the whole way. No city to wait on
        // any more; the server names one from the marker.
        continueDisabled={coords == null}
        note={
          addressFocused
            ? 'Pick your address from the list.'
            : pinYourself && coords == null
              ? 'Zoom in and tap the map on your door.'
              : null
        }
        onBack={() => go(4)}
        continueTestID="business-place-continue"
        onContinue={() => {
          setTouched(true);
          if (coords == null) {
            return;
          }
          // Forward to the confirm step. This said go(3) once and sent an
          // owner back to the name screen instead, which is a loop with no
          // way out of the form.
          go(6);
        }}>
        {/* ONE BOX, ANYWHERE ON EARTH. No "Which city?" and no preset list:
            the founder's 2026-09-05 decision retired the launch-city fence
            for businesses the day after it went for pins. The address is the
            way in; a suggestion sets both the words and the marker; typing
            sets only the words; and the small line under the box is for an
            address that is not coming up. The city is the server's answer
            (city_for_spot), printed under the map once there is a marker. */}
        <BusinessAddressField
          onFocusChange={setAddressFocused}
          value={address}
          near={coords}
          onChangeText={(next) => setAddress(next.slice(0, ADDRESS_MAX))}
          onPick={(place) => {
            setAddress(addressFrom(place));
            setCoords({ lat: place.latitude, lng: place.longitude });
          }}
          onSetPin={
            coords == null && !pinYourself
              ? (near) => {
                  // The nearest miss the search had, else the featured city
                  // on this phone's clock zone at country scale (Intl only,
                  // section 7 rule 2), else the world. Never a device fix.
                  setMapStart(
                    near
                      ? { ...near, delta: 0.03 }
                      : zoneCity
                        ? { lat: zoneCity.cities.lat, lng: zoneCity.cities.lng, delta: 2.5 }
                        : WORLD_START
                  );
                  setPinYourself(true);
                }
              : undefined
          }
        />
        {!addressFocused && (coords != null || pinYourself) ? (
          <>
            <LocationPicker
              // Remounted when a marker first lands: the picker reads its
              // centre once, through initialRegion, and the by-hand map
              // opened at country scale has to fly to street scale.
              key={coords ? 'placed' : 'placing'}
              centerLat={coords?.lat ?? mapStart?.lat ?? WORLD_START.lat}
              centerLng={coords?.lng ?? mapStart?.lng ?? WORLD_START.lng}
              // Street level once there is a marker: "check the marker is
              // on your door" cannot be answered by seven kilometres of city.
              delta={coords ? 0.004 : (mapStart?.delta ?? WORLD_START.delta)}
              lat={coords?.lat ?? mapStart?.lat ?? WORLD_START.lat}
              lng={coords?.lng ?? mapStart?.lng ?? WORLD_START.lng}
              // No marker until there is one to draw: a map with a marker
              // on it, a greyed Continue, and a note asking for a marker
              // was the screen this replaced.
              placed={coords != null}
              // The chip a traveler will actually tap, not MapKit's red
              // balloon. Category is picked a step before this map.
              marker={category ? <PlaceGlyph category={category} /> : undefined}
              // Only the marker. The address stays exactly as typed, which
              // is the founder's rule and the reason these are two fields.
              onChange={(lat, lng) => setCoords({ lat, lng })}
            />
            {coords != null ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {address.trim().length > 0
                  ? 'Move the marker as much as you like. Your address stays as you wrote it.'
                  : 'Just the marker is fine. You can add the street later.'}
              </ThemedText>
            ) : null}
            {coords != null && spotCity ? (
              <ThemedText type="footnote" themeColor="textSecondary" testID="business-spot-city">
                {`That puts you in ${spotCity.name}, ${spotCity.country_name}.`}
              </ThemedText>
            ) : null}
          </>
        ) : null}
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
            {spotCity ? ` · ${spotCity.name}, ${spotCity.country_name}` : ''}
          </ThemedText>
          <ThemedText type="body">
            {address.trim().length > 0 ? address.trim() : 'No address, just the marker.'}
          </ThemedText>
        </View>
        {coords ? (
          <LocationPicker
            key="confirm"
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
        <PrimaryButton
          variant="ghost"
          label="Fix the address or the marker"
          onPress={() => go(5)}
        />
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
        // The grid below owns the sentence about the cover now, and it is a
        // true one wherever the list ends up: "the first one that clears"
        // meant "the lowest surviving position" after any delete, which is
        // not something a bar owner can reason about. Repeating it here would
        // also have printed it twice, one line apart.
        subtitle="The first thing a traveler sees when they tap you on the map."
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
        continueLoading={savingDescription}
        note={descriptionProblem ?? descriptionError ?? CHANGE_LATER}
        onBack={() => go(8)}
        onSkip={() => go(10)}
        onContinue={() => void saveDescription()}>
        {/* The text, in place. This step used to be a headline, a subtitle, a
            thousand points of black and a button that pushed /business-edit
            at the details section - so a step that asks one question handed
            over a 1,430-line settings form with a Save that writes nine other
            fields. Run 49 is the picture of it. The same field the editor
            draws, down to the 600-character cap and the characters-left hint,
            because it is the same text and two ways of typing it is two
            things to keep in step. */}
        <FormTextField
          label="About the business"
          testID="business-description-input"
          placeholder="What it's like, who turns up, what to order."
          autoFocus
          multiline
          numberOfLines={4}
          style={styles.multiline}
          value={descriptionText}
          onChangeText={setDescription}
          error={descriptionError}
          hint={
            descriptionText.length > DESCRIPTION_MAX - 100
              ? `${DESCRIPTION_MAX - descriptionText.length} characters left`
              : undefined
          }
        />
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
        ) : (
          // Something to look at while deciding whether this app is real, at
          // the size the real thing occupies: pick some days, pick two times.
          <ExampleBlock what="One line of hours looks like this">
            <ThemedText type="footnote" themeColor="textTertiary">
              Mon to Fri
            </ThemedText>
            <View style={styles.exampleChips}>
              {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                <View key={weekday} style={[styles.exampleChip, { borderColor: theme.hairline }]}>
                  <ThemedText type="footnote" themeColor="textTertiary">
                    {weekdayLabel(weekday)}
                  </ThemedText>
                </View>
              ))}
            </View>
            <View style={styles.exampleTimes}>
              <ThemedText type="footnote" themeColor="textTertiary">
                Opens 09:00
              </ThemedText>
              <ThemedText type="footnote" themeColor="textTertiary">
                Closes 17:00
              </ThemedText>
            </View>
          </ExampleBlock>
        )}
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
        ) : (
          // Two rows in the shape the real ones take: what the button says,
          // and what kind of link it is. Same two lines BusinessLinks draws.
          <ExampleBlock what="Two links look like this">
            {[
              { label: 'Menu', kind: LINK_LABEL.menu },
              { label: 'Book a table', kind: LINK_LABEL.reservations },
            ].map((row) => (
              <View key={row.label} style={styles.exampleRow}>
                <ThemedText type="callout" themeColor="textTertiary">
                  {row.label}
                </ThemedText>
                <ThemedText type="footnote" themeColor="textTertiary">
                  {row.kind}
                </ThemedText>
              </View>
            ))}
          </ExampleBlock>
        )}
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
        cityName={spotCity?.name ?? businessCityRow?.name ?? null}
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
 * Grey furniture at the size the real thing will occupy.
 *
 * The hours and links steps were a headline over an empty screen, and an
 * owner deciding whether this app is real had nothing to look at while they
 * decided. This is not data and must never be mistaken for it: textTertiary
 * on a sunken card, a caption saying what it is, and ONE accessibility
 * element for the whole thing, so VoiceOver reads "an example of..." rather
 * than a set of opening hours the business does not have.
 */
function ExampleBlock({ what, children }: { what: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.block}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {what}
      </ThemedText>
      <View
        accessible
        accessibilityLabel={what}
        style={[styles.exampleCard, { backgroundColor: theme.surfaceSunken }]}>
        {children}
      </View>
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
  multiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  // Furniture, not data: the same card the real thing sits in, with nothing
  // in it that could be read as this business's own hours or links.
  exampleCard: {
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  exampleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  exampleChip: {
    minWidth: HitTarget,
    minHeight: HitTarget - 8,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exampleTimes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.lg,
  },
  exampleRow: {
    gap: 2,
  },
  footerLine: {
    textAlign: 'center',
  },
  // A quiet full-height row: 44pt to tap, footnote-sized to read.
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
