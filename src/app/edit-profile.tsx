import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { LanguageField } from '@/components/form/language-field';
import { FormTextField } from '@/components/form/form-text-field';
import { SelectField } from '@/components/form/select-field';
import { StepScreen } from '@/components/form/step-screen';
import { PhotoGrid } from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
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

/** Which block each Edit affordance on the profile is pointing at. */
type Section = 'photos' | 'about' | 'details' | 'socials';

function EditProfileForm({ profile }: { profile: ProfileRow }) {
  const updateProfile = useUpdateOwnProfile();
  // Four Edit affordances on the profile page have always passed a section
  // here — the hero's camera button, and the headers on About, Details and
  // Socials — and this screen never read it, so every one of them landed you
  // at the top of the same long form and left you to find the thing you had
  // just tapped.
  const { section } = useLocalSearchParams<{ section?: Section }>();
  const scroller = useRef<ScrollView>(null);
  const [targetY, setTargetY] = useState<number | null>(null);

  // Only the block that was asked for reports its position, and the scroll
  // happens in an effect: a handler created during render may not touch a
  // ref, and the scroller has its content height by the time this runs.
  const measure = (key: Section) => (event: LayoutChangeEvent) => {
    if (section === key) {
      setTargetY(event.nativeEvent.layout.y);
    }
  };

  useEffect(() => {
    if (targetY == null) {
      return;
    }
    scroller.current?.scrollTo({ y: Math.max(targetY - Space.md, 0), animated: false });
  }, [targetY]);

  const [name, setName] = useState(profile.display_name ?? '');
  const [age, setAge] = useState(profile.age != null ? String(profile.age) : '');
  const [gender, setGender] = useState<Gender>(profile.gender);
  const [city, setCity] = useState(profile.home_city ?? '');
  const [country, setCountry] = useState(profile.home_country ?? '');
  const [languages, setLanguages] = useState<string[]>(profile.languages);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [occupation, setOccupation] = useState(profile.occupation ?? '');

  // Whether anything has actually changed. Compared against the profile as
  // it was loaded, not against a snapshot taken on mount, so a value typed
  // and then typed back does not count as dirty.
  const dirty =
    name !== (profile.display_name ?? '') ||
    age !== (profile.age != null ? String(profile.age) : '') ||
    gender !== profile.gender ||
    city !== (profile.home_city ?? '') ||
    country !== (profile.home_country ?? '') ||
    bio !== (profile.bio ?? '') ||
    occupation !== (profile.occupation ?? '') ||
    languages.length !== profile.languages.length ||
    languages.some((code, index) => code !== profile.languages[index]);

  // A swipe down used to eat a whole bio rewrite in silence. The Close
  // button asks; the swipe is still there for anybody who prefers it, and
  // this at least means there is a way out that does not gamble.
  const close = () => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Discard your changes?', "You'll lose what you wrote.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

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
      // Deselect your only language to swap it and Save simply stopped
      // working: name, age and bio all showed no error, so the one thing
      // blocking it was the one thing not saying so.
      note={
        languages.length === 0 && nameError == null && ageError == null && bioError == null
          ? 'Pick at least one language you can chat in.'
          : null
      }
      continueLoading={updateProfile.isPending}
      onContinue={save}
      onClose={close}
      scrollRef={scroller}>
      <FormTextField label="Name" value={name} onChangeText={setName} error={nameError} />
      <FormTextField
        label="Age"
        keyboardType="number-pad"
        value={age}
        onChangeText={setAge}
        error={ageError}
      />
      <View onLayout={measure('details')} />
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
      <View onLayout={measure('about')} />
      <FormTextField
        label="Bio"
        multiline
        numberOfLines={4}
        style={styles.bioInput}
        value={bio}
        onChangeText={setBio}
        error={bioError}
      />
      <ThemedText type="smallBold" onLayout={measure('photos')}>
        Photos
      </ThemedText>
      <PhotoGrid />
      <ThemedText type="smallBold" onLayout={measure('socials')}>
        Socials
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Only shown to people you&apos;re chatting with.
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
