import { router } from 'expo-router';

import { StepScreen } from '@/components/form/step-screen';
import { PhotoGrid } from '@/components/photo-grid';
import { useOwnPhotos } from '@/features/profile/hooks';
import { PHOTOS_MAX } from '@/features/profile/validation';

export default function OnboardingPhotosScreen() {
  const { data: photos = [] } = useOwnPhotos();

  return (
    <StepScreen
      title="Photos"
      subtitle={`Step 4 of 6 — a profile photo to continue, and up to ${PHOTOS_MAX - 1} more for your gallery.`}
      continueDisabled={photos.length === 0}
      // navigate (not push) so a double-tap can't stack the bio step twice.
      onContinue={() => router.navigate('/onboarding/bio')}>
      <PhotoGrid />
    </StepScreen>
  );
}
