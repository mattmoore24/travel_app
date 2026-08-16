import { router } from 'expo-router';
import { useState } from 'react';

import { ChipRow } from '@/components/form/chip-row';
import { StepScreen } from '@/components/form/step-screen';
import { LANGUAGES } from '@/constants/languages';
import { useOwnProfile, useUpdateOwnProfile } from '@/features/profile/hooks';
import { LANGUAGES_MAX } from '@/features/profile/validation';
import type { ProfileRow } from '@/lib/database.types';

export default function OnboardingLanguagesScreen() {
  const { data: profile } = useOwnProfile();
  if (!profile) {
    return null;
  }
  return <LanguagesForm profile={profile} />;
}

function LanguagesForm({ profile }: { profile: ProfileRow }) {
  const updateProfile = useUpdateOwnProfile();
  const [selected, setSelected] = useState<string[]>(profile.languages);

  const toggle = (code: string) => {
    setSelected((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : current.length < LANGUAGES_MAX
          ? [...current, code]
          : current
    );
  };

  const submit = async () => {
    try {
      await updateProfile.mutateAsync({ languages: selected });
      router.push('/onboarding/photos');
    } catch {
      // Surfaced by the global mutation error alert; stay on this step.
    }
  };

  return (
    <StepScreen
      title="Languages"
      subtitle="Step 3 of 6 — what can you chat in?"
      continueDisabled={selected.length === 0}
      continueLoading={updateProfile.isPending}
      onContinue={submit}>
      <ChipRow options={LANGUAGES} selected={selected} onToggle={toggle} />
    </StepScreen>
  );
}
