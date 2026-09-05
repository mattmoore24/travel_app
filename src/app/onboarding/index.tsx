import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LanguageField } from '@/components/form/language-field';
import { CityField } from '@/components/form/city-field';
import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { SelectField } from '@/components/form/select-field';
import { PhotoGrid } from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import {
  useOwnPhotos,
  useOwnProfile,
  useOwnSocialHandles,
  useOwnUserId,
  useOwnVisibility,
  useProfilePriorities,
  useProfilePrompts,
  useSetVisibility,
  useUpdateOwnProfile,
} from '@/features/profile/hooks';
import {
  AUDIENCE_BOTH_WAYS,
  AUDIENCE_LABEL,
  AUDIENCE_GENDER_NOTE,
  AUDIENCE_NEEDS_BADGE,
} from '@/features/profile/audience';
import { AudiencePicker } from '@/features/profile/audience-picker';
import {
  useVerificationCapture,
  VerificationCaptureBody,
  VERIFICATION_SUBTITLE,
  VERIFICATION_TITLE,
} from '@/features/profile/verification-capture';
import { SocialHandlesEditor } from '@/features/profile/social-handles-editor';
import {
  BIO_MAX,
  LANGUAGES_MAX,
  basicsProblem,
  validateAge,
  validateBio,
  validateDisplayName,
} from '@/features/profile/validation';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import { MAX_PROMPTS, promptLabelInline } from '@/features/profile/prompts';
import { rememberWantedAudience } from '@/features/profile/wanted-audience';
import { MAX_PRIORITIES } from '@/features/profile/priorities';
import { useMyTrips } from '@/features/trips/hooks';
import { formatDateRange } from '@/features/trips/dates';
import { profileTripFromOwnTrip } from '@/features/trips/profile-trips';
import { StepShell } from '@/features/signup/step-shell';
import { resumeStep } from '@/features/signup/resume';
import { SIGNUP_TOTAL_STEPS, signupStepName } from '@/features/signup/steps';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/hooks/use-theme';
import type { CityRow, Gender, ProfileAudience, ProfileRow } from '@/lib/database.types';

/**
 * The same sentence on every step that has one, in the same place.
 *
 * Founder: "a caveat at each step that this can be changed later at any
 * time." One constant rather than thirteen hand-written reassurances, because
 * the moment they drift they stop reading as a promise and start reading as
 * filler.
 */
const CHANGE_LATER = 'You can change this any time, from your profile.';

/** The last step: the profile itself, and where an edit jump comes back to. */
const REVIEW_STEP = SIGNUP_TOTAL_STEPS;
/** The two before it, named because the badge step hands over to the audience step. */
const AUDIENCE_STEP = SIGNUP_TOTAL_STEPS - 1;
const BADGE_STEP = SIGNUP_TOTAL_STEPS - 2;

/**
 * The badge's own version of CHANGE_LATER. A badge is not "changed" from the
 * profile; it is taken there, once, whenever somebody gets round to it.
 */
const DO_LATER = 'You can do this any time, from your profile.';

// No "Rather not say". Founder, 2026-09-04: it "goes against our filters", and
// it did: the gendered audiences go by this value, so an unspecified profile
// could narrow itself to verified women while sitting in no gendered audience
// at all. 'unspecified' is still the column default every account is born
// with (and what a guest stays), which is why the type keeps it and step 3
// refuses it.
const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Non-binary' },
];

export default function OnboardingScreen() {
  const profileQuery = useOwnProfile();
  const profile = profileQuery.data;
  // The four queries the resumed step number is derived from. They are read
  // HERE, one level above the steps, because ProfileSteps seeds its step from
  // them in a useState initialiser: a query that lands after that first render
  // is a step number that changes under the person's finger. Same hold
  // rootIsReady already takes for profile, standing and business, and the
  // queries are the very ones ProfileSteps goes on to use, so react-query
  // serves both reads from one fetch.
  const userId = useOwnUserId();
  const photosQuery = useOwnPhotos();
  const promptsQuery = useProfilePrompts(userId);
  const prioritiesQuery = useProfilePriorities(userId);
  const tripsQuery = useMyTrips();
  // Somebody who signed up through "Run a business? Put it on the map" belongs
  // in the listing form, and the replace that was supposed to take them there
  // is dispatched while the root's readiness hold has the navigator unmounted,
  // so it is dropped. Without this they land here — and this is the one flow a
  // place must never finish, because completing it stamps
  // `onboarding_completed_at` and `register_business` then refuses the account
  // outright. The flag is cleared by the form itself, so backing out of it
  // leaves them here rather than bouncing.
  const listingIntent = useAuthStore((s) => s.listingIntent);
  if (listingIntent) {
    return <Redirect href="/business-signup" />;
  }
  // An error counts as settled, exactly as it does in rootIsReady: a fetch
  // that failed is a reason to open at step 3, never a reason to hold a
  // brand-new account on a blank screen forever.
  const settled = [photosQuery, promptsQuery, prioritiesQuery, tripsQuery].every(
    (query) => query.isSuccess || query.isError
  );
  if (!profile || !settled) {
    return null;
  }
  // ProfileSteps reads the same four queries itself, for the live values it
  // renders. It gets them from the cache on its very first render because of
  // the hold above, which is the whole point: the step it seeds from them is
  // decided once and never moves.
  return <ProfileSteps profile={profile} />;
}

/**
 * Steps three through six: who you are, where you are from, the optional
 * extras, then photos. Each screen asks for one thing, everything is saved
 * on the way past it, and nothing here can be got wrong permanently — the
 * same fields are editable from the profile afterwards.
 */
function ProfileSteps({ profile }: { profile: ProfileRow }) {
  const theme = useTheme();
  const updateProfile = useUpdateOwnProfile();
  const { data: audience = 'everyone' } = useOwnVisibility();
  const setAudience = useSetVisibility();
  const { data: photos = [] } = useOwnPhotos();
  const hasProfilePhoto = photos.some((photo) => photo.position === 0);
  // The three sections nothing used to ask for. Read rather than edited here:
  // each step explains what the section is and hands over to the editor that
  // already owns it, which is also the editor people will use forever after.
  const userId = useOwnUserId();
  const { data: prompts = [] } = useProfilePrompts(userId);
  const { data: priorities = [] } = useProfilePriorities(userId);
  const { data: trips = [] } = useMyTrips();
  // Warm from step 11's editor, so the review step shows what was actually
  // entered rather than the "None yet" an empty array would draw. Not part of
  // the hold above: a socials list that has not landed yet is a section that
  // says nothing for a beat, not a wrong profile.
  const { data: handles = [] } = useOwnSocialHandles();
  const profileTrips: ProfileTrip[] = trips.map(profileTripFromOwnTrip);

  // Not `useState(3)`. Every field on every screen is prefilled from the saved
  // profile and saveAndGo writes on the way past each step, so nothing was
  // ever lost by quitting — but the position was thrown away, and somebody who
  // stopped at the photo step came back to "Who are you?" and had to re-confirm
  // four screens that each showed their own answer already in the box. An
  // initialiser, so it is decided once from data the parent has already
  // waited for.
  const [step, setStep] = useState(() =>
    resumeStep({ profile, hasProfilePhoto, prompts, priorities, trips })
  );
  // Set while somebody is off fixing one section from the review step.
  const [returnTo, setReturnTo] = useState<number | null>(null);
  // The audience step's door. A brand-new account can never be verified, so
  // every row but Everyone is locked - and the step used to name the badge,
  // say it lives somewhere else, and hand you no way to get one. The badge has
  // a step of its own before this one now; the door stays for whoever skipped
  // it. `wantedAudience` is the row that was reached for, kept so it can be
  // applied the moment the badge clears rather than asking again.
  const [capturingBadge, setCapturingBadge] = useState(false);
  const [wantedAudience, setWantedAudience] = useState<ProfileAudience | null>(null);
  const appliedWanted = useRef(false);
  const [name, setName] = useState(profile.display_name ?? '');
  const [age, setAge] = useState(profile.age != null ? String(profile.age) : '');
  // 'unspecified' here means the column default, never an answer: the
  // opt-out is gone (see GENDER_OPTIONS), so the value alone says whether the
  // question was answered and the `genderTouched` flag that used to tell a
  // deliberate "Rather not say" from never-asked has nothing left to tell.
  const [gender, setGender] = useState<Gender>(profile.gender);
  const [city, setCity] = useState(profile.home_city ?? '');
  const [country, setCountry] = useState(profile.home_country ?? '');
  const [languages, setLanguages] = useState<string[]>(profile.languages);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [occupation, setOccupation] = useState(profile.occupation ?? '');
  const [touched, setTouched] = useState(false);

  /**
   * Take the city AND its country from the reference row.
   *
   * Both text columns keep being written — nothing that reads them today
   * breaks, and a profile whose city is not in the table is still expressible
   * — but a picked one now writes the same two strings for everybody who
   * picks it, which is the whole point: 'Deutschland', 'Germany' and 'DE'
   * were three countries.
   */
  const pickHomeCity = (choice: CityRow) => {
    setCity(choice.name);
    setCountry(choice.country_name);
  };

  const nameError = touched ? validateDisplayName(name) : null;
  const ageError = touched ? validateAge(age) : null;
  const bioError = validateBio(bio);
  const basicsOk = basicsProblem({ name, age, gender }) == null;
  const homeOk = (city.trim().length > 0 || country.trim().length > 0) && languages.length > 0;

  // The one door every step leaves through, so the funnel event lives here
  // and nowhere else. It used to sit in saveAndGo, which only four steps
  // called: steps advancing through go() alone — including the photo gate
  // with its three iOS permission dialogs and the trip step that decides
  // whether a profile is visible to matching at all — emitted nothing
  // (docs/PRODUCT_BRIEF.md §6 wants day-one metrics). Only a FORWARD move is
  // a completion; onBack routes through here too. Step 13's exit is
  // onboarding_completed below, which closes the funnel end to end.
  const go = (next: number, { skipped = false }: { skipped?: boolean } = {}) => {
    haptics.light();
    setTouched(false);
    if (next > step) {
      analytics.capture('signup_step_completed', {
        step_index: step,
        step_name: signupStepName(step),
        skipped,
      });
    }
    // A jump out of the review step is a round trip: fix the one thing, tap
    // Continue (or Back, which is also the review), and you are looking at
    // the profile again. Without it, editing the bio from step 13 dropped
    // somebody into the middle of signup with six steps to walk a second
    // time - which is the ten-Back-taps problem the jump exists to end.
    if (returnTo != null) {
      setReturnTo(null);
      setStep(returnTo);
      return;
    }
    setStep(next);
  };

  // The capture, mounted for the whole of ProfileSteps rather than only while
  // a step shows it: the hook holds the selfie somebody just took, and a
  // component that unmounts between the shot and the submit throws it away.
  // Two steps draw it. On the badge step, done means the next screen; on the
  // audience step, where it is a door opened from a locked row, done means
  // the door closes. The hook runs every render, so this closure is current.
  const badge = useVerificationCapture({
    onDone: () => (step === BADGE_STEP ? go(AUDIENCE_STEP) : setCapturingBadge(false)),
  });

  // The row that was reached for, applied the moment the badge is real. A
  // ref rather than clearing state, because a setState inside an effect is a
  // cascading render (and the lint rule that says so) - and the mutation is
  // idempotent enough that "once" is the only guarantee needed.
  useEffect(() => {
    if (!appliedWanted.current && profile.verified && wantedAudience) {
      appliedWanted.current = true;
      setAudience.mutate(wantedAudience);
    }
  }, [profile.verified, wantedAudience, setAudience]);

  /** Leave the review step for the one that owns a section, and come back. */
  const jumpToStep = (next: number) => {
    haptics.light();
    setTouched(false);
    setReturnTo(REVIEW_STEP);
    setStep(next);
  };

  // Saved as you pass each step rather than all at the end, so a dropped
  // connection on step six does not cost someone their whole profile.
  // No capture here: go() owns the event, and a second one in this function
  // would double-count the four steps that save.
  const saveAndGo = async (
    patch: Parameters<typeof updateProfile.mutateAsync>[0],
    next: number
  ) => {
    try {
      await updateProfile.mutateAsync(patch);
      go(next);
    } catch {
      // Surfaced by the global mutation error alert; stay on the step.
    }
  };

  // Every step gets it, not just the last one. A person who signs up on
  // hostel wifi that drops gets "Could not save" on step 3 and, before this,
  // had no back, no sign out and no way to reach the app: an account that
  // cannot finish was worse off than no account at all.
  //
  // Quiet, though. It was a full-width ghost button under every step, the
  // same weight as the skip and nearly the weight of Continue, on screens
  // where the person has not yet reached the app they would be signing out
  // of. Founder, 2026-09-04: "not really a need for the sign out prompt to be
  // so prominent during onboarding as you are still just creating your
  // account". A footnote-sized line, the same voice as the skip, still 44pt
  // tall so it can be hit, and still on every step for the reason above.
  const signOutFooter = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      haptic="light"
      scaleTo={0.98}
      onPress={() => {
        signOut().catch(() => {});
      }}
      style={styles.quietAction}>
      <ThemedText type="footnote" themeColor="textSecondary">
        Sign out
      </ThemedText>
    </PressableScale>
  );

  // The fork, and it can only live here.
  //
  // A business account is one whose `onboarding_completed_at` stays NULL
  // forever, so the offer has to be made BEFORE that stamp exists, which
  // means before this flow finishes. Every other surface in the app is on the
  // far side of it. Step 3 rather than a later one because somebody who runs
  // a bar should not have to type their own age first to find out they were
  // in the wrong flow.
  const businessFooter = (
    <>
      <PrimaryButton
        variant="ghost"
        label="Run a business? Put it on the map."
        // Replace, for the reason written at the other two entrances: nothing
        // may be left under business-signup, because registering flips a
        // guard that filters whatever is under it out of the navigator. There
        // is nothing to go back to here either — an account on its way to list
        // a bar must not be able to walk back into traveler onboarding, which
        // register_business refuses forever once it is finished.
        onPress={() => router.replace('/business-signup')}
      />
      {signOutFooter}
    </>
  );

  if (step === 3) {
    return (
      <StepShell
        step={3}
        total={SIGNUP_TOTAL_STEPS}
        title="Who are you?"
        subtitle="The name people will see, your gender, and your age."
        // Deliberately pressable while incomplete: pressing is what marks the
        // fields touched, which is what shows the person WHY it will not go
        // through. A disabled button just sits there.
        continueLoading={updateProfile.isPending}
        // The one outstanding answer without a field error of its own. Name
        // and age already turn their fields red; gender is a closed select
        // that cannot, so the shell's note carries it — the pattern step 4
        // already uses for its own missing answers.
        note={
          touched && nameError == null && ageError == null
            ? basicsProblem({ name, age, gender })
            : null
        }
        footer={businessFooter}
        onContinue={() => {
          setTouched(true);
          if (!basicsOk) {
            return;
          }
          saveAndGo({ display_name: name.trim(), age: Number(age.trim()), gender }, 4);
        }}>
        <FormTextField
          label="Name"
          testID="name-input"
          // No autoFocus any more. There are three answers on this screen
          // now, and a keyboard that opens on arrival scrolls this field into
          // view and Gender out of it — which is how the women-only filter's
          // data was shipping as 'unspecified' from people who never saw the
          // question. Same reason join.tsx dropped it from Email.
          autoComplete="given-name"
          value={name}
          onChangeText={setName}
          error={nameError}
        />
        {/* Above Age, so all three questions sit in the first viewport with
            the keyboard down. Age used to be second, and the screenshot that
            made this a finding showed it sliced in half by the footer with
            Gender nowhere on screen. */}
        <SelectField
          label="Gender"
          testID="gender-select"
          options={GENDER_OPTIONS}
          // null, not the column default: the picker would find no option for
          // 'unspecified' and show its placeholder anyway, but a value the
          // list does not carry should be said out loud rather than fallen
          // through to.
          value={gender === 'unspecified' ? null : gender}
          onChange={setGender}
        />
        {/* A number pad draws no return key at all, so before the Done
            bar the only way out of this field was Continue, which commits
            and advances rather than putting the keyboard away. */}
        <FormTextField
          label="Age"
          testID="age-input"
          keyboardType="number-pad"
          value={age}
          onChangeText={setAge}
          error={ageError}
        />
      </StepShell>
    );
  }

  if (step === 4) {
    return (
      <StepShell
        step={4}
        total={SIGNUP_TOTAL_STEPS}
        title="Where are you from?"
        subtitle="Home base, not where you happen to be today."
        continueLoading={updateProfile.isPending}
        note={!homeOk ? 'Add where you are from and at least one language you can chat in.' : null}
        footer={signOutFooter}
        onBack={() => go(3)}
        onContinue={() =>
          !homeOk
            ? undefined
            : saveAndGo(
                {
                  home_city: city.trim() || null,
                  home_country: country.trim() || null,
                  languages,
                },
                5
              )
        }>
        {/* The same component Edit profile mounts, not a second copy of it.
            The hand-rolled list that used to sit here had already drifted
            from the shared one it was supposed to match: no minHeight at all
            (about 39pt, under the 44 floor), a different ground colour, and a
            comment claiming the geometry was add-trip's while differing from
            it in both. One component is the only version of this that cannot
            drift again. */}
        <CityField
          label="City"
          testID="city-input"
          autoFocus
          value={city}
          onChangeText={setCity}
          onPick={pickHomeCity}
        />
        <FormTextField
          label="Country"
          testID="country-input"
          value={country}
          onChangeText={setCountry}
          autoComplete="country"
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          Tap a suggestion and both fill themselves in. Not listed? What you type is fine.
        </ThemedText>
        <View style={styles.block}>
          <ThemedText type="callout">Languages</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Anything you can hold a conversation in.
          </ThemedText>
          <LanguageField selected={languages} onChange={setLanguages} max={LANGUAGES_MAX} />
        </View>
      </StepShell>
    );
  }

  if (step === 5) {
    return (
      <StepShell
        step={5}
        total={SIGNUP_TOTAL_STEPS}
        title="Add a photo"
        subtitle="One face, so people know who they are meeting. Add more if you like."
        continueTestID="finish-photos"
        // The slot the copy actually names. Adding one through the small "+"
        // under "More photos, all optional" used to satisfy this, leaving the
        // profile photo empty on a screen headed "Add a photo".
        continueDisabled={!hasProfilePhoto}
        note={hasProfilePhoto ? CHANGE_LATER : 'A profile photo is the one thing we need.'}
        footer={signOutFooter}
        onBack={() => go(4)}
        onContinue={() => go(6)}>
        {/* The footer note above already states the requirement, so the tile
            caption carries the one instruction that decides whether the photo
            works: founder, 2026-09-04, replacing "People decide whether to say
            hi from this", which said why it mattered and not what to do. */}
        <PhotoGrid missingNote="Make sure your face is clearly visible in your profile photo." />
      </StepShell>
    );
  }

  if (step === 6) {
    return (
      <StepShell
        step={6}
        total={SIGNUP_TOTAL_STEPS}
        title="What do you do?"
        subtitle="Two words is plenty. It gives somebody an easy thing to ask about."
        continueLoading={updateProfile.isPending}
        note={CHANGE_LATER}
        footer={signOutFooter}
        onBack={() => go(5)}
        onSkip={() => go(7, { skipped: true })}
        skipLabel="Skip what you do for now"
        onContinue={() => saveAndGo({ occupation: occupation.trim() || null }, 7)}>
        <FormTextField
          label="What you do"
          testID="occupation-input"
          autoFocus
          placeholder="Nurse, studying architecture, between jobs"
          value={occupation}
          onChangeText={setOccupation}
        />
      </StepShell>
    );
  }

  if (step === 7) {
    return (
      <StepShell
        step={7}
        total={SIGNUP_TOTAL_STEPS}
        title="A bit about you"
        subtitle="What should somebody message you about? This sits under your photo."
        continueDisabled={bioError != null}
        continueLoading={updateProfile.isPending}
        note={CHANGE_LATER}
        footer={signOutFooter}
        onBack={() => go(6)}
        onSkip={() => go(8, { skipped: true })}
        skipLabel="Skip the bio for now"
        onContinue={() => saveAndGo({ bio: bio.trim() || null }, 8)}>
        <FormTextField
          multiline
          testID="bio-input"
          numberOfLines={5}
          style={styles.bioInput}
          placeholder="Street food missions, museum days, sunrise hikes, learning to surf badly"
          value={bio}
          onChangeText={setBio}
          error={bioError}
          hint={`${bio.length}/${BIO_MAX}`}
        />
      </StepShell>
    );
  }

  if (step === 8) {
    return (
      <StepShell
        step={8}
        total={SIGNUP_TOTAL_STEPS}
        title="Answer a prompt"
        subtitle="The bit people actually read. One answer puts you ahead of most profiles."
        continueLabel={prompts.length > 0 ? 'Continue' : 'Pick a prompt'}
        note={CHANGE_LATER}
        footer={signOutFooter}
        onBack={() => go(7)}
        onSkip={prompts.length > 0 ? undefined : () => go(9, { skipped: true })}
        skipLabel="Skip the prompts for now"
        onContinue={() => (prompts.length > 0 ? go(9) : router.push('/edit-prompt'))}>
        {prompts.length === 0 ? (
          <PrimaryButton
            variant="ghost"
            label="Pick a prompt"
            testID="onboarding-add-prompt"
            onPress={() => router.push('/edit-prompt')}
          />
        ) : (
          <>
            {prompts.map((prompt) => (
              <View
                key={prompt.slot}
                style={[styles.card, { backgroundColor: theme.surfaceSunken }]}>
                <ThemedText type="caption" themeColor="textSecondary">
                  {promptLabelInline(prompt.prompt_key).toUpperCase()}
                </ThemedText>
                <ThemedText>{prompt.answer}</ThemedText>
              </View>
            ))}
            {prompts.length < MAX_PROMPTS ? (
              <PrimaryButton
                variant="ghost"
                label="Answer another"
                onPress={() => router.push('/edit-prompt')}
              />
            ) : null}
          </>
        )}
      </StepShell>
    );
  }

  if (step === 9) {
    return (
      <StepShell
        step={9}
        total={SIGNUP_TOTAL_STEPS}
        title="Add your top priorities for your trip"
        subtitle="Places, food, a night out, the one thing you would hate to miss. So the right people say hi."
        continueLabel={priorities.length > 0 ? 'Continue' : 'Add one'}
        note={CHANGE_LATER}
        footer={signOutFooter}
        onBack={() => go(8)}
        onSkip={priorities.length > 0 ? undefined : () => go(10, { skipped: true })}
        skipLabel="Skip this for now"
        onContinue={() => (priorities.length > 0 ? go(10) : router.push('/edit-priorities'))}>
        {priorities.length === 0 ? (
          <PrimaryButton
            variant="ghost"
            label="Add one"
            testID="onboarding-add-priority"
            onPress={() => router.push('/edit-priorities')}
          />
        ) : (
          <>
            {priorities.map((priority) => (
              <View
                key={priority.slot}
                style={[styles.card, { backgroundColor: theme.surfaceSunken }]}>
                <ThemedText>{priority.text}</ThemedText>
              </View>
            ))}
            {priorities.length < MAX_PRIORITIES ? (
              <PrimaryButton
                variant="ghost"
                label="Add another"
                onPress={() => router.push('/edit-priorities')}
              />
            ) : null}
          </>
        )}
      </StepShell>
    );
  }

  if (step === 10) {
    return (
      <StepShell
        step={10}
        total={SIGNUP_TOTAL_STEPS}
        title="Where are you going?"
        // The one step that earns the extra length. Everything else on a
        // profile is decoration next to this: the whole app matches people by
        // city and dates, so a profile with no trip is invisible to the
        // feature it exists for. Nothing used to ask.
        subtitle="A city and your dates. This is what puts you in front of the people who will be there when you are."
        continueLabel={trips.length > 0 ? 'Continue' : 'Add a trip'}
        note={CHANGE_LATER}
        footer={signOutFooter}
        onBack={() => go(9)}
        onSkip={trips.length > 0 ? undefined : () => go(11, { skipped: true })}
        skipLabel="I'll add it later"
        // The consequence, named at the moment of choice: travelers.tsx
        // returns the whole tab as a wall whenever trips.length === 0, and
        // that wall used to arrive later, on a different screen, with no
        // memory that skipping was a choice this person made.
        skipNote="Travelers stays closed until you do. The map does not."
        onContinue={() => (trips.length > 0 ? go(11) : router.push('/add-trip'))}>
        {trips.length === 0 ? (
          <>
            <PrimaryButton
              variant="ghost"
              label="Add a trip"
              testID="onboarding-add-trip"
              onPress={() => router.push('/add-trip')}
            />
            <ThemedText type="footnote" themeColor="textSecondary">
              No trip yet is fine. You can still drop a pin and read the map, and you can add one
              the moment you book.
            </ThemedText>
          </>
        ) : (
          <>
            {trips.map((trip) => (
              <View key={trip.id} style={[styles.card, { backgroundColor: theme.surfaceSunken }]}>
                <ThemedText type="callout">
                  {trip.cities.name}, {trip.cities.country_name}
                </ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {formatDateRange(trip.start_date, trip.end_date)}
                </ThemedText>
              </View>
            ))}
            <PrimaryButton
              variant="ghost"
              label="Add another"
              onPress={() => router.push('/add-trip')}
            />
          </>
        )}
      </StepShell>
    );
  }

  if (step === 11) {
    return (
      <StepShell
        step={11}
        total={SIGNUP_TOTAL_STEPS}
        title="Your socials"
        subtitle="Nobody sees these until you are both in a chat. Not on your profile, not on the map."
        note={CHANGE_LATER}
        footer={signOutFooter}
        onBack={() => go(10)}
        onSkip={() => go(12, { skipped: true })}
        skipLabel="Skip your socials for now"
        onContinue={() => go(12)}>
        <SocialHandlesEditor />
      </StepShell>
    );
  }

  if (step === 12) {
    // THE BADGE, AS A STEP. It was only a door on the audience step, opened
    // by tapping a locked row, and the founder walked the sequence without
    // finding it: "There should be an option to verify your profile during
    // onboarding." Skippable, because the audience has a default and
    // set_visibility works without a badge; what the skip costs is said under
    // it, and the audience step keeps its door for anyone who skipped.
    //
    // Presented in place for the same reason the door is: `/verification`
    // sits inside `Stack.Protected guard={signedIn && onboarded}` and an
    // onboarding account satisfies neither half, so a push from here is a
    // tap that silently does nothing.
    //
    // A selfie can be sent while the profile photo from step 5 is still being
    // checked: submit_verification accepts a pending photo and the worker
    // waits for it to clear rather than rejecting (20260904100000). Before
    // that, taking the selfie seven screens after the photo was the commonest
    // way to be told "add a profile photo before verifying".
    const badgeSettled = badge.verified || badge.pending;
    return (
      <StepShell
        step={12}
        total={SIGNUP_TOTAL_STEPS}
        title={VERIFICATION_TITLE}
        subtitle={VERIFICATION_SUBTITLE}
        // The hook's own labels once a selfie is in hand ("Take a selfie",
        // "Submit selfie"); a plain Continue once there is nothing left to do
        // here, because "Done" and "Close" are route words for a screen that
        // is left, and this one is walked through.
        continueLabel={badgeSettled ? 'Continue' : badge.continueLabel}
        continueLoading={badge.submitting}
        note={DO_LATER}
        footer={signOutFooter}
        onBack={() => go(11)}
        onSkip={badgeSettled ? undefined : () => go(13, { skipped: true })}
        skipLabel="Skip the badge for now"
        // The cost, where the choice is made: the next screen's verified-only
        // rows are inert without it, and that is the server's rule.
        skipNote="The verified-only options on the next screen stay locked until you do."
        onContinue={badgeSettled ? () => go(13) : badge.onContinue}>
        <VerificationCaptureBody capture={badge} />
      </StepShell>
    );
  }

  if (step === 13) {
    // THE DOOR. Presented in place, not pushed: `/verification` sits inside
    // `Stack.Protected guard={signedIn && onboarded}` and an onboarding
    // account satisfies neither half, so a push from here is a tap that
    // silently does nothing. In place also means no second modal over a
    // dismissing one, which on Fabric does not lose a sheet - it kills touch
    // for the whole app (traps).
    return (
      <StepShell
        step={13}
        total={SIGNUP_TOTAL_STEPS}
        // One shell, two faces. The capture has a step of its own now (12),
        // and this is still the door for whoever skipped it: the same hook,
        // opened in place, so the chrome, the progress bar and the sign-out
        // footer stay exactly where they were and nothing remounts under the
        // person's finger.
        //
        // A statement for a brand-new account, because the step is a reading
        // screen for them: set_visibility refuses a narrowed audience without
        // the badge, so every row but Everyone is inert and a question whose
        // only possible answer is the default is not a question. The question
        // form comes back the day the account is verified and the choice is
        // real.
        title={
          capturingBadge
            ? VERIFICATION_TITLE
            : profile.verified
              ? 'Who you see, and who sees you'
              : 'Who can see you'
        }
        subtitle={capturingBadge ? VERIFICATION_SUBTITLE : AUDIENCE_BOTH_WAYS}
        // "Got it" rather than "Continue" for the same reason: the button
        // acknowledges a fact, it does not submit an answer.
        continueLabel={
          capturingBadge ? badge.continueLabel : profile.verified ? 'Continue' : 'Got it'
        }
        continueLoading={capturingBadge && badge.submitting}
        // What the badge is FOR, while it is being taken: the row that was
        // reached for is applied the moment the check passes, so nobody has
        // to come back and set it again.
        note={
          capturingBadge && wantedAudience
            ? `Once the badge lands we will set you to ${AUDIENCE_LABEL[wantedAudience].toLowerCase()}.`
            : null
        }
        footer={signOutFooter}
        onBack={capturingBadge ? () => setCapturingBadge(false) : () => go(12)}
        onContinue={capturingBadge ? badge.onContinue : () => go(14)}>
        {capturingBadge ? <VerificationCaptureBody capture={badge} /> : null}
        {/* Everything but Everyone is inert here, and that is the server's
            rule rather than this screen's: set_visibility refuses a narrowed
            audience from an account without the badge, and a brand-new
            account never has one. Showing the locked rows anyway is the whole
            point of the step — somebody who never learns the setting exists
            is exactly who the founder wanted this step for. */}
        {/* WHY the rows below are locked, read before they are tapped rather
            than discovered after. */}
        {capturingBadge || profile.verified ? null : (
          <ThemedText type="footnote" themeColor="textSecondary">
            {AUDIENCE_NEEDS_BADGE} Tap one and you can take the selfie here.
          </ThemedText>
        )}
        {capturingBadge ? null : (
          <>
            <AudiencePicker
              value={audience}
              verified={profile.verified}
              disabled={setAudience.isPending}
              onChange={(next) => setAudience.mutate(next)}
              // A locked row is a door now. It kept naming the badge, saying
              // it lives somewhere else, and doing nothing at all when tapped
              // - so a woman finishing signup was set to Everyone and never
              // asked again. router.push cannot work from here:
              // <Stack.Screen name="verification"> sits inside
              // `Stack.Protected guard={signedIn && onboarded}` and an
              // onboarding account satisfies neither half.
              onLockedPress={(wanted) => {
                setWantedAudience(wanted);
                // ...and on the DEVICE as well, because this step cannot keep
                // the promise its note makes. The check takes minutes and the
                // rest of signup takes seconds, so this component is always
                // long gone by the time the badge arrives; the profile picks
                // the wish up from storage and spends it there.
                void rememberWantedAudience(wanted);
                setCapturingBadge(true);
              }}
            />
            <ThemedText type="footnote" themeColor="textSecondary">
              {AUDIENCE_GENDER_NOTE}
            </ThemedText>
            {/* Said plainly, because a setting that feels permanent is one
                people get wrong and then live with. */}
            <ThemedText type="footnote" themeColor="textSecondary">
              You can change this any time, at the top of your profile.
            </ThemedText>
          </>
        )}
      </StepShell>
    );
  }

  // THE LAST STEP IS THE PROFILE ITSELF.
  //
  // Founder: "It should also give you a final look of how your profile
  // appears to other users at the end of onboarding, with the option to go
  // back and edit any portion before completing the initial onboarding."
  //
  // The same component a stranger gets, in owner mode, so this is not a
  // preview of the profile — it IS the profile. Every section's edit
  // affordance jumps to the step that owns it, which is what the subtitle
  // promises; the shell's Back still walks one step at a time.
  return (
    <StepShell
      step={14}
      total={SIGNUP_TOTAL_STEPS}
      title="Here you are"
      subtitle="Your profile. Tap any part of it to change it."
      continueLabel="Looks right, finish"
      continueTestID="finish-profile"
      continueLoading={updateProfile.isPending}
      note="Every part of this is editable from your profile afterwards."
      footer={signOutFooter}
      onBack={() => go(13)}
      onContinue={async () => {
        try {
          await updateProfile.mutateAsync({ onboarding_completed_at: new Date().toISOString() });
          analytics.capture('onboarding_completed');
          haptics.success();
          // The root guard swaps to the tabs once the profile is complete.
        } catch {
          // Surfaced by the global mutation error alert.
        }
      }}>
      <View style={styles.review}>
        <ProfileView
          photosPending={false}
          profile={profile}
          photos={photos}
          prompts={prompts}
          priorities={priorities}
          trips={profileTrips}
          handles={handles}
          // Owner mode, and every affordance wired to a STEP rather than a
          // route. The step used to render the stranger's copy and tell
          // people to "step back to change anything", where back was a
          // one-step chevron: fixing a typo in your name cost ten Back taps
          // through ten animated transitions. ProfileView has no router
          // import and makes no navigation of its own - every owner
          // affordance is a caller-supplied callback - so the same component
          // that pushes guarded routes from the profile page jumps steps
          // here. docs/ONBOARDING.md section 3 specifies exactly this.
          owner
          connected={false}
          onEditSection={(section) =>
            jumpToStep(
              section === 'photos' ? 5 : section === 'details' ? 4 : section === 'about' ? 7 : 11
            )
          }
          onEditPrompt={() => jumpToStep(8)}
          onEditPriorities={() => jumpToStep(9)}
          // Not the TripEditor sheet: opening a modal from inside StepShell
          // is the Fabric touch-death trap the traps skill records.
          onEditTrips={() => jumpToStep(10)}
        />
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Space.sm,
  },
  card: {
    gap: 2,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  review: {
    // The profile draws its own full-bleed hero, so it cancels the shell's
    // gutter rather than sitting inside it as a card.
    marginHorizontal: -Space.lg,
  },
  // The skip's own geometry (step-shell.tsx `skip`), so Sign out sits under
  // it as a second quiet line rather than a second button.
  quietAction: {
    minHeight: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bioInput: {
    minHeight: 120,
    textAlignVertical: 'top',
    borderRadius: Radius.md,
  },
});
