import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { LanguageField } from '@/components/form/language-field';
import { FormTextField } from '@/components/form/form-text-field';
import { SelectField } from '@/components/form/select-field';
import { StepScreen } from '@/components/form/step-screen';
import { PhotoGrid } from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { useOwnProfile, useUpdateOwnProfile } from '@/features/profile/hooks';
import { SocialHandlesEditor } from '@/features/profile/social-handles-editor';
import {
  LANGUAGES_MAX,
  validateAge,
  validateBio,
  validateDisplayName,
} from '@/features/profile/validation';
import type { Gender, ProfileRow } from '@/lib/database.types';

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'unspecified', label: 'Rather not say' },
];

// Only reachable once onboarded, so the profile row always exists; the inner
// form initializes from it directly (no state-syncing effects).
export default function EditProfileScreen() {
  const { data: profile } = useOwnProfile();
  if (!profile) {
    return null;
  }
  return <EditProfileForm profile={profile} />;
}

function EditProfileForm({ profile }: { profile: ProfileRow }) {
  const updateProfile = useUpdateOwnProfile();

  const [name, setName] = useState(profile.display_name ?? '');
  const [age, setAge] = useState(profile.age != null ? String(profile.age) : '');
  const [gender, setGender] = useState<Gender>(profile.gender);
  const [city, setCity] = useState(profile.home_city ?? '');
  const [country, setCountry] = useState(profile.home_country ?? '');
  const [languages, setLanguages] = useState<string[]>(profile.languages);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [occupation, setOccupation] = useState(profile.occupation ?? '');

  const nameError = validateDisplayName(name);
  const ageError = validateAge(age);
  const bioError = validateBio(bio);
  const valid = nameError == null && ageError == null && bioError == null && languages.length > 0;

  const save = async () => {
    try {
      await updateProfile.mutateAsync({
        display_name: name.trim(),
        age: Number(age.trim()),
        gender,
        home_city: city.trim() || null,
        home_country: country.trim() || null,
        languages,
        bio: bio.trim() || null,
        occupation: occupation.trim() || null,
      });
      router.back();
    } catch {
      // Surfaced by the global mutation error alert; stay on the form.
    }
  };

  return (
    <StepScreen
      title="Edit profile"
      continueLabel="Save"
      continueDisabled={!valid}
      continueLoading={updateProfile.isPending}
      onContinue={save}>
      <FormTextField label="Name" value={name} onChangeText={setName} error={nameError} />
      <FormTextField
        label="Age"
        keyboardType="number-pad"
        value={age}
        onChangeText={setAge}
        error={ageError}
      />
      <SelectField label="Gender" options={GENDER_OPTIONS} value={gender} onChange={setGender} />
      <FormTextField
        label="What you do"
        placeholder="Nurse, studying architecture, between jobs"
        value={occupation}
        onChangeText={setOccupation}
      />
      <FormTextField label="Home city" value={city} onChangeText={setCity} />
      <FormTextField label="Home country" value={country} onChangeText={setCountry} />
      <ThemedText type="smallBold">Languages</ThemedText>
      <LanguageField selected={languages} onChange={setLanguages} max={LANGUAGES_MAX} />
      <FormTextField
        label="Bio"
        multiline
        numberOfLines={4}
        style={styles.bioInput}
        value={bio}
        onChangeText={setBio}
        error={bioError}
      />
      <ThemedText type="smallBold">Photos</ThemedText>
      <PhotoGrid />
      <ThemedText type="smallBold">Socials</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Only shared with people you are chatting with.
      </ThemedText>
      <SocialHandlesEditor />
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  bioInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
