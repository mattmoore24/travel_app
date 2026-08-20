import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { SelectField } from '@/components/form/select-field';
import { PhotoGrid } from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { LANGUAGES } from '@/constants/languages';
import { Radius, Space } from '@/constants/theme';
import { signOut } from '@/features/auth/api';
import { useOwnPhotos, useOwnProfile, useUpdateOwnProfile } from '@/features/profile/hooks';
import { SocialHandlesEditor } from '@/features/profile/social-handles-editor';
import {
  BIO_MAX,
  LANGUAGES_MAX,
  validateAge,
  validateBio,
  validateDisplayName,
} from '@/features/profile/validation';
import { StepShell } from '@/features/signup/step-shell';
import { SIGNUP_TOTAL_STEPS } from '@/features/signup/steps';
import { haptics } from '@/lib/haptics';
import type { Gender, ProfileRow } from '@/lib/database.types';

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'unspecified', label: 'Rather not say' },
];

export default function OnboardingScreen() {
  const { data: profile } = useOwnProfile();
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
  const updateProfile = useUpdateOwnProfile();
  const { data: photos = [] } = useOwnPhotos();

  const [step, setStep] = useState(3);
  const [name, setName] = useState(profile.display_name ?? '');
  const [age, setAge] = useState(profile.age != null ? String(profile.age) : '');
  const [gender, setGender] = useState<Gender>(profile.gender);
  const [city, setCity] = useState(profile.home_city ?? '');
  const [country, setCountry] = useState(profile.home_country ?? '');
  const [languages, setLanguages] = useState<string[]>(profile.languages);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [occupation, setOccupation] = useState(profile.occupation ?? '');
  const [touched, setTouched] = useState(false);

  const nameError = touched ? validateDisplayName(name) : null;
  const ageError = touched ? validateAge(age) : null;
  const bioError = validateBio(bio);
  const basicsOk = validateDisplayName(name) == null && validateAge(age) == null;
  const homeOk = (city.trim().length > 0 || country.trim().length > 0) && languages.length > 0;

  const toggleLanguage = (code: string) => {
    setLanguages((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : current.length < LANGUAGES_MAX
          ? [...current, code]
          : current
    );
  };

  const go = (next: number) => {
    haptics.light();
    setTouched(false);
    setStep(next);
  };

  // Saved as you pass each step rather than all at the end, so a dropped
  // connection on step six does not cost someone their whole profile.
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

  if (step === 3) {
    return (
      <StepShell
        step={3}
        total={SIGNUP_TOTAL_STEPS}
        title="Who are you?"
        subtitle="The name people will see, and your age."
        // Deliberately pressable while incomplete: pressing is what marks the
        // fields touched, which is what shows the person WHY it will not go
        // through. A disabled button just sits there.
        continueLoading={updateProfile.isPending}
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
          autoFocus
          autoComplete="given-name"
          value={name}
          onChangeText={setName}
          error={nameError}
        />
        <FormTextField
          label="Age"
          testID="age-input"
          keyboardType="number-pad"
          value={age}
          onChangeText={setAge}
          error={ageError}
        />
        <SelectField
          label="Gender"
          testID="gender-select"
          options={GENDER_OPTIONS}
          value={gender}
          onChange={setGender}
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
          <ChipRow options={LANGUAGES} selected={languages} onToggle={toggleLanguage} />
        </View>
      </StepShell>
    );
  }

  if (step === 5) {
    return (
      <StepShell
        step={5}
        total={SIGNUP_TOTAL_STEPS}
        title="Anything else?"
        subtitle="All optional, all editable later."
        continueLabel={bio.trim() || occupation.trim() ? 'Continue' : 'Skip for now'}
        continueDisabled={bioError != null}
        continueLoading={updateProfile.isPending}
        onBack={() => go(4)}
        onContinue={() =>
          saveAndGo({ bio: bio.trim() || null, occupation: occupation.trim() || null }, 6)
        }>
        <FormTextField
          label="What you do"
          testID="occupation-input"
          placeholder="Nurse, studying architecture, between jobs"
          value={occupation}
          onChangeText={setOccupation}
        />
        <View style={styles.block}>
          <ThemedText type="callout">A bit about you</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            What should someone message you about?
          </ThemedText>
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
        </View>
        <View style={styles.block}>
          <ThemedText type="callout">Socials</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Only shared once you and someone else are chatting.
          </ThemedText>
          <SocialHandlesEditor />
        </View>
      </StepShell>
    );
  }

  return (
    <StepShell
      step={6}
      total={SIGNUP_TOTAL_STEPS}
      title="Add a photo"
      subtitle="One is enough to start. You can add more any time."
      continueLabel="Finish"
      continueTestID="finish-profile"
      continueDisabled={photos.length === 0}
      continueLoading={updateProfile.isPending}
      note={photos.length === 0 ? 'A profile photo is the one thing we need.' : null}
      onBack={() => go(5)}
      onContinue={async () => {
        try {
          await updateProfile.mutateAsync({ onboarding_completed_at: new Date().toISOString() });
          haptics.success();
          // The root guard swaps to the tabs once the profile is complete.
        } catch {
          // Surfaced by the global mutation error alert.
        }
      }}
      footer={
        <PrimaryButton
          variant="ghost"
          label="Sign out"
          onPress={() => {
            signOut().catch(() => {});
          }}
        />
      }>
      <PhotoGrid />
    </StepShell>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Space.sm,
  },
  bioInput: {
    minHeight: 120,
    textAlignVertical: 'top',
    borderRadius: Radius.md,
  },
});
