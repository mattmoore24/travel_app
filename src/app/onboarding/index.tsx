import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LanguageField } from '@/components/form/language-field';
import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { PrimaryButton } from '@/components/form/primary-button';
import { SelectField } from '@/components/form/select-field';
import { PhotoGrid } from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space } from '@/constants/theme';
import { signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import {
  useOwnPhotos,
  useOwnProfile,
  useOwnUserId,
  useOwnVisibility,
  useProfilePriorities,
  useProfilePrompts,
  useSetVisibility,
  useUpdateOwnProfile,
} from '@/features/profile/hooks';
import {
  AUDIENCE_BOTH_WAYS,
  AUDIENCE_GENDER_NOTE,
  AUDIENCE_NEEDS_BADGE,
} from '@/features/profile/audience';
import { AudiencePicker } from '@/features/profile/audience-picker';
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
import { MAX_PRIORITIES } from '@/features/profile/priorities';
import { useMyTrips } from '@/features/trips/hooks';
import { formatDateRange } from '@/features/trips/dates';
import { StepShell } from '@/features/signup/step-shell';
import { SIGNUP_TOTAL_STEPS, signupStepName } from '@/features/signup/steps';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/hooks/use-theme';
import type { Gender, ProfileRow } from '@/lib/database.types';

/**
 * The same sentence on every step that has one, in the same place.
 *
 * Founder: "a caveat at each step that this can be changed later at any
 * time." One constant rather than thirteen hand-written reassurances, because
 * the moment they drift they stop reading as a promise and start reading as
 * filler.
 */
const CHANGE_LATER = 'You can change this any time, from your profile.';

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'unspecified', label: 'Rather not say' },
];

export default function OnboardingScreen() {
  const { data: profile } = useOwnProfile();
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
  if (!profile) {
    return null;
  }
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
  const profileTrips: ProfileTrip[] = trips.map((trip) => ({
    id: trip.id,
    cityId: trip.city_id,
    cityLabel: `${trip.cities.name}, ${trip.cities.country_name}`,
    startDate: trip.start_date,
    endDate: trip.end_date,
  }));

  const [step, setStep] = useState(3);
  const [name, setName] = useState(profile.display_name ?? '');
  const [age, setAge] = useState(profile.age != null ? String(profile.age) : '');
  const [gender, setGender] = useState<Gender>(profile.gender);
  // Whether the gender question has ever been ANSWERED, as opposed to left
  // at its column default. 'unspecified' is both the honest opt-out ("Rather
  // not say") and the silent default, so the value alone cannot tell "chose
  // not to say" from "never saw the question" — and the women-only audience
  // filter was filling with defaults from people who never saw it. A saved
  // non-default value counts as answered, so backing up to this step never
  // asks twice.
  const [genderTouched, setGenderTouched] = useState(
    // A saved non-default gender proves the question was answered. So do
    // saved basics: name and age are only ever written by step 3's Continue,
    // which this very gate refuses until gender is touched — so a person who
    // picked "Rather not say" (stored as the column default, which the DB
    // cannot tell from never-asked) is not asked twice after a relaunch.
    profile.gender !== 'unspecified' || (profile.display_name != null && profile.age != null)
  );
  const [city, setCity] = useState(profile.home_city ?? '');
  const [country, setCountry] = useState(profile.home_country ?? '');
  const [languages, setLanguages] = useState<string[]>(profile.languages);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [occupation, setOccupation] = useState(profile.occupation ?? '');
  const [touched, setTouched] = useState(false);

  const nameError = touched ? validateDisplayName(name) : null;
  const ageError = touched ? validateAge(age) : null;
  const bioError = validateBio(bio);
  const basicsOk = basicsProblem({ name, age, genderTouched }) == null;
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
  const signOutFooter = (
    <PrimaryButton
      variant="ghost"
      label="Sign out"
      onPress={() => {
        signOut().catch(() => {});
      }}
    />
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
        onPress={() => router.push('/business-signup')}
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
            ? basicsProblem({ name, age, genderTouched })
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
          value={gender}
          onChange={(next) => {
            setGender(next);
            setGenderTouched(true);
          }}
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
          {...keyboardDoneProps}
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
        <FormTextField
          label="City"
          testID="city-input"
          autoFocus
          value={city}
          onChangeText={setCity}
          autoComplete="off"
        />
        <FormTextField
          label="Country"
          testID="country-input"
          value={country}
          onChangeText={setCountry}
          autoComplete="country"
        />
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
        <PhotoGrid />
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
          {...keyboardDoneProps}
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
        title="What are you after?"
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
    return (
      <StepShell
        step={12}
        total={SIGNUP_TOTAL_STEPS}
        // A statement for a brand-new account, because the step is a reading
        // screen for them: set_visibility refuses a narrowed audience without
        // the badge, so every row but Everyone is inert and a question whose
        // only possible answer is the default is not a question. The question
        // form comes back the day the account is verified and the choice is
        // real.
        title={profile.verified ? 'Who you see, and who sees you' : 'Who can see you'}
        subtitle={AUDIENCE_BOTH_WAYS}
        // "Got it" rather than "Continue" for the same reason: the button
        // acknowledges a fact, it does not submit an answer.
        continueLabel={profile.verified ? 'Continue' : 'Got it'}
        footer={signOutFooter}
        onBack={() => go(11)}
        onContinue={() => go(13)}>
        {/* Everything but Everyone is inert here, and that is the server's
            rule rather than this screen's: set_visibility refuses a narrowed
            audience from an account without the badge, and a brand-new
            account never has one. Showing the locked rows anyway is the whole
            point of the step — somebody who never learns the setting exists
            is exactly who the founder wanted this step for. */}
        {/* WHY the rows below are locked, read before they are tapped rather
            than discovered after. */}
        {profile.verified ? null : (
          <ThemedText type="footnote" themeColor="textSecondary">
            {AUDIENCE_NEEDS_BADGE} The selfie check lives on your profile once you are in.
          </ThemedText>
        )}
        <AudiencePicker
          value={audience}
          verified={profile.verified}
          disabled={setAudience.isPending}
          onChange={(next) => setAudience.mutate(next)}
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          {AUDIENCE_GENDER_NOTE}
        </ThemedText>
        {/* Said plainly, because a setting that feels permanent is one people
            get wrong and then live with. */}
        <ThemedText type="footnote" themeColor="textSecondary">
          You can change this any time, at the top of your profile.
        </ThemedText>
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
  // preview of the profile — it IS the profile. Backing up from here lands on
  // the step that owns whatever looks wrong.
  return (
    <StepShell
      step={13}
      total={SIGNUP_TOTAL_STEPS}
      title="Here you are"
      subtitle="Exactly what a stranger sees. Step back to change anything."
      continueLabel="Looks right, finish"
      continueTestID="finish-profile"
      continueLoading={updateProfile.isPending}
      note="Every part of this is editable from your profile afterwards."
      footer={signOutFooter}
      onBack={() => go(12)}
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
          handles={[]}
          // NOT owner mode, and that is the point of the step: the founder
          // asked for "a final look of how your profile appears to other
          // users", and owner mode adds edit affordances that push to routes
          // sitting behind the `onboarded` guard — which this account is not
          // yet, so every one of them would be a tap that does nothing. The
          // way back is the shell's own Back, through the step that owns
          // whatever looks wrong.
          owner={false}
          connected={false}
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
  bioInput: {
    minHeight: 120,
    textAlignVertical: 'top',
    borderRadius: Radius.md,
  },
});
