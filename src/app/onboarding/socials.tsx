import { ThemedText } from '@/components/themed-text';
import { StepScreen } from '@/components/form/step-screen';
import { useOwnPhotos, useOwnProfile, useUpdateOwnProfile } from '@/features/profile/hooks';
import { SocialHandlesEditor } from '@/features/profile/social-handles-editor';
import { missingOnboardingFields } from '@/features/profile/validation';

export default function OnboardingSocialsScreen() {
  const { data: profile } = useOwnProfile();
  const { data: photos = [] } = useOwnPhotos();
  const updateProfile = useUpdateOwnProfile();

  const missing = profile ? missingOnboardingFields(profile, photos.length) : [];

  const finish = async () => {
    try {
      await updateProfile.mutateAsync({
        onboarding_completed_at: new Date().toISOString(),
      });
      // The root guard swaps to the tabs stack once the profile updates.
    } catch {
      // Surfaced by the global mutation error alert; stay on this step.
    }
  };

  return (
    <StepScreen
      title="Socials (optional)"
      subtitle="Step 6 of 6 — kept hidden until you accept a chat with someone. Enforced by the database, not a setting."
      continueLabel="Finish"
      continueDisabled={missing.length > 0}
      continueLoading={updateProfile.isPending}
      onContinue={finish}
      footer={
        missing.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Still needed before you finish: {missing.join(', ')}.
          </ThemedText>
        ) : undefined
      }>
      <SocialHandlesEditor />
    </StepScreen>
  );
}
