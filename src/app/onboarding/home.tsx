import { router } from 'expo-router';
import { useState } from 'react';

import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { useOwnProfile, useUpdateOwnProfile } from '@/features/profile/hooks';
import type { ProfileRow } from '@/lib/database.types';

export default function OnboardingHomeScreen() {
  const { data: profile } = useOwnProfile();
  if (!profile) {
    return null;
  }
  return <HomeForm profile={profile} />;
}

function HomeForm({ profile }: { profile: ProfileRow }) {
  const updateProfile = useUpdateOwnProfile();

  const [city, setCity] = useState(profile.home_city ?? '');
  const [country, setCountry] = useState(profile.home_country ?? '');

  const valid = city.trim().length > 0 || country.trim().length > 0;

  const submit = async () => {
    try {
      await updateProfile.mutateAsync({
        home_city: city.trim() || null,
        home_country: country.trim() || null,
      });
      router.push('/onboarding/languages');
    } catch {
      // Surfaced by the global mutation error alert; stay on this step.
    }
  };

  return (
    <StepScreen
      title="Home base"
      subtitle="Step 2 of 6 — where you're from (not where you are)."
      continueDisabled={!valid}
      continueLoading={updateProfile.isPending}
      onContinue={submit}>
      <FormTextField label="City" value={city} onChangeText={setCity} autoComplete="off" />
      <FormTextField
        label="Country"
        value={country}
        onChangeText={setCountry}
        autoComplete="country"
      />
    </StepScreen>
  );
}
