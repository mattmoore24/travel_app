import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { PhotoGrid } from '@/components/photo-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LANGUAGES } from '@/constants/languages';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
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
import { haptics } from '@/lib/haptics';
import type { Gender, ProfileRow } from '@/lib/database.types';

const GENDER_OPTIONS = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'unspecified', label: 'Rather not say' },
] as const;

export default function OnboardingScreen() {
  const { data: profile } = useOwnProfile();
  if (!profile) {
    return null;
  }
  return <ProfileBuilder profile={profile} />;
}

/**
 * One page, one button. The old version split this across six pushed screens,
 * which made a profile feel like paperwork; everything that makes you findable
 * now lives on a single scroll and nothing is saved until the last tap.
 */
function ProfileBuilder({ profile }: { profile: ProfileRow }) {
  const updateProfile = useUpdateOwnProfile();
  const { data: photos = [] } = useOwnPhotos();

  const [name, setName] = useState(profile.display_name ?? '');
  const [age, setAge] = useState(profile.age != null ? String(profile.age) : '');
  const [gender, setGender] = useState<Gender>(profile.gender);
  const [city, setCity] = useState(profile.home_city ?? '');
  const [country, setCountry] = useState(profile.home_country ?? '');
  const [languages, setLanguages] = useState<string[]>(profile.languages);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [touched, setTouched] = useState(false);

  const nameError = touched ? validateDisplayName(name) : null;
  const ageError = touched ? validateAge(age) : null;
  const bioError = validateBio(bio);

  const homeOk = city.trim().length > 0 || country.trim().length > 0;
  const ready =
    validateDisplayName(name) == null &&
    validateAge(age) == null &&
    bioError == null &&
    homeOk &&
    languages.length > 0 &&
    photos.length > 0;

  // Named so the button can say what is actually missing instead of just
  // sitting there greyed out.
  const missing: string[] = [];
  if (validateDisplayName(name) != null) missing.push('your name');
  if (validateAge(age) != null) missing.push('your age');
  if (!homeOk) missing.push('where you are from');
  if (languages.length === 0) missing.push('a language');
  if (photos.length === 0) missing.push('a photo');

  const toggleLanguage = (code: string) => {
    setLanguages((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : current.length < LANGUAGES_MAX
          ? [...current, code]
          : current
    );
  };

  const finish = async () => {
    setTouched(true);
    if (!ready) {
      return;
    }
    try {
      await updateProfile.mutateAsync({
        display_name: name.trim(),
        age: Number(age.trim()),
        gender,
        home_city: city.trim() || null,
        home_country: country.trim() || null,
        languages,
        bio: bio.trim() || null,
        onboarding_completed_at: new Date().toISOString(),
      });
      haptics.success();
      // The root guard swaps to the tabs stack once the profile updates.
    } catch {
      // Surfaced by the global mutation error alert; stay on the page.
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled">
            <ThemedText type="title">Set up your profile</ThemedText>
            <ThemedText themeColor="textSecondary">
              This is what people see when you show up in their city. You can change any of it later
              from your profile.
            </ThemedText>

            <View style={styles.section}>
              <ThemedText type="headline">Photos</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                One is enough to start. Faces do better than landscapes.
              </ThemedText>
              <PhotoGrid />
            </View>

            <View style={styles.section}>
              <ThemedText type="headline">The basics</ThemedText>
              <FormTextField
                label="Name"
                testID="name-input"
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
                hint="You need to be 18 or older."
              />
              <ThemedText type="smallBold">Gender</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                Only used for safety filters like a women-only view. Never a matching category.
              </ThemedText>
              <ChipRow
                options={GENDER_OPTIONS}
                selected={[gender]}
                onToggle={(value) => setGender(value)}
              />
            </View>

            <View style={styles.section}>
              <ThemedText type="headline">Where you are from</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                Home base, not where you are right now.
              </ThemedText>
              <FormTextField
                label="City"
                testID="city-input"
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
            </View>

            <View style={styles.section}>
              <ThemedText type="headline">Languages</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                Pick any you can hold a conversation in.
              </ThemedText>
              <ChipRow options={LANGUAGES} selected={languages} onToggle={toggleLanguage} />
            </View>

            <View style={styles.section}>
              <ThemedText type="headline">A bit about you</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                What should someone message you about? Optional, but it works.
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
              />
              <ThemedText type="footnote" themeColor="textSecondary">
                {bio.length}/{BIO_MAX}
              </ThemedText>
            </View>

            <View style={styles.section}>
              <ThemedText type="headline">Socials</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                Optional, and hidden until you accept a chat with someone. That is enforced by the
                database, not a setting you can forget.
              </ThemedText>
              <SocialHandlesEditor />
            </View>
          </ScrollView>

          <ThemedView style={styles.footer}>
            {missing.length > 0 ? (
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.footerNote}>
                Still need {missing.join(', ')}
              </ThemedText>
            ) : null}
            <PrimaryButton
              label="Create account"
              testID="create-account"
              disabled={!ready}
              loading={updateProfile.isPending}
              onPress={finish}
            />
            <PrimaryButton
              variant="ghost"
              label="Sign out"
              onPress={() => {
                signOut().catch(() => {});
              }}
            />
          </ThemedView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  flex: {
    flex: 1,
  },
  content: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxl,
  },
  section: {
    gap: Space.sm,
  },
  bioInput: {
    minHeight: 120,
    textAlignVertical: 'top',
    borderRadius: Radius.md,
  },
  footer: {
    padding: Space.lg,
    paddingTop: Space.sm,
    gap: Space.sm,
  },
  footerNote: {
    textAlign: 'center',
  },
});
