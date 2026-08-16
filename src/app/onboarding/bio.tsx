import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { useOwnProfile, useUpdateOwnProfile } from '@/features/profile/hooks';
import { BIO_MAX, validateBio } from '@/features/profile/validation';
import type { ProfileRow } from '@/lib/database.types';

export default function OnboardingBioScreen() {
  const { data: profile } = useOwnProfile();
  if (!profile) {
    return null;
  }
  return <BioForm profile={profile} />;
}

function BioForm({ profile }: { profile: ProfileRow }) {
  const updateProfile = useUpdateOwnProfile();
  const [bio, setBio] = useState(profile.bio ?? '');

  const error = validateBio(bio);

  const submit = async () => {
    try {
      await updateProfile.mutateAsync({ bio: bio.trim() || null });
      router.push('/onboarding/socials');
    } catch {
      // Surfaced by the global mutation error alert; stay on this step.
    }
  };

  return (
    <StepScreen
      title="Interests"
      subtitle="Step 5 of 6 — what should people message you about?"
      continueDisabled={error != null}
      continueLoading={updateProfile.isPending}
      onContinue={submit}>
      <FormTextField
        multiline
        numberOfLines={5}
        style={styles.bioInput}
        placeholder="Street food missions, museum days, sunrise hikes, learning surf…"
        value={bio}
        onChangeText={setBio}
        error={error}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {bio.length}/{BIO_MAX}
      </ThemedText>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  bioInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
});
