import { router } from 'expo-router';
import { useState } from 'react';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { useOwnProfile, useUpdateOwnProfile } from '@/features/profile/hooks';
import { validateAge, validateDisplayName } from '@/features/profile/validation';
import type { Gender, ProfileRow } from '@/lib/database.types';

const GENDER_OPTIONS = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'unspecified', label: 'Prefer not to say' },
] as const;

// The root guard only mounts onboarding after the profile query settles, so
// waiting here is just a frame or two; the inner form initializes its state
// from the loaded row (supports resuming a half-finished onboarding).
export default function OnboardingAboutScreen() {
  const { data: profile } = useOwnProfile();
  if (!profile) {
    return null;
  }
  return <AboutForm profile={profile} />;
}

function AboutForm({ profile }: { profile: ProfileRow }) {
  const updateProfile = useUpdateOwnProfile();

  const [name, setName] = useState(profile.display_name ?? '');
  const [age, setAge] = useState(profile.age != null ? String(profile.age) : '');
  const [gender, setGender] = useState<Gender>(profile.gender);
  const [touched, setTouched] = useState(false);

  const nameError = touched ? validateDisplayName(name) : null;
  const ageError = touched && age !== '' ? validateAge(age) : null;
  const valid = validateDisplayName(name) == null && validateAge(age) == null;

  const submit = async () => {
    setTouched(true);
    if (!valid) {
      return;
    }
    await updateProfile.mutateAsync({
      display_name: name.trim(),
      age: Number(age.trim()),
      gender,
    });
    router.push('/onboarding/home');
  };

  return (
    <StepScreen
      title="About you"
      subtitle="Step 1 of 6 — how you'll appear to other travelers."
      continueDisabled={touched && !valid}
      continueLoading={updateProfile.isPending}
      onContinue={submit}>
      <FormTextField
        label="Name"
        autoComplete="given-name"
        value={name}
        onChangeText={setName}
        error={nameError}
      />
      <FormTextField
        label="Age"
        keyboardType="number-pad"
        value={age}
        onChangeText={setAge}
        error={ageError}
        hint="You must be 18 or older."
      />
      <ThemedText type="smallBold">Gender</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Used only for optional safety visibility filters (like a women-only
        view) — never shown as a matching category.
      </ThemedText>
      <ChipRow
        options={GENDER_OPTIONS}
        selected={[gender]}
        onToggle={(value) => setGender(value)}
      />
    </StepScreen>
  );
}
