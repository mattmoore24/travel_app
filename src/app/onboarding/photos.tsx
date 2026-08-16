import { router } from 'expo-router';

import { StepScreen } from '@/components/form/step-screen';
import { PhotoGrid } from '@/components/photo-grid';
import { useOwnPhotos } from '@/features/profile/hooks';

export default function OnboardingPhotosScreen() {
  const { data: photos = [] } = useOwnPhotos();

  return (
    <StepScreen
      title="Photos"
      subtitle="Step 4 of 6 — add at least a profile photo (up to 7 total)."
      continueDisabled={photos.length === 0}
      onContinue={() => router.push('/onboarding/bio')}>
      <PhotoGrid />
    </StepScreen>
  );
}
