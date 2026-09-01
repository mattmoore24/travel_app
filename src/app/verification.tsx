import { router } from 'expo-router';

import { StepScreen } from '@/components/form/step-screen';
import {
  useVerificationCapture,
  VerificationCaptureBody,
  VERIFICATION_SUBTITLE,
  VERIFICATION_TITLE,
} from '@/features/profile/verification-capture';

/**
 * Selfie verification, as a route.
 *
 * The capture itself lives in features/profile/verification-capture, because
 * signup needs the same thing and cannot have this route: it sits inside
 * `Stack.Protected guard={signedIn && onboarded}` and an account halfway
 * through signup satisfies neither half, so a push from there does nothing at
 * all. This file is the door from the profile; the piece behind it is shared.
 */
export default function VerificationScreen() {
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/profile-me'));
  const capture = useVerificationCapture({ onDone: leave });

  return (
    <StepScreen
      title={VERIFICATION_TITLE}
      subtitle={VERIFICATION_SUBTITLE}
      continueLabel={capture.continueLabel}
      continueLoading={capture.submitting}
      // Without this the first-run state's only button says "Take a selfie",
      // so the modal has no visible exit at all and the swipe down is a
      // gesture nothing on screen mentions.
      onClose={capture.verified || capture.pending ? undefined : leave}
      onContinue={capture.onContinue}>
      <VerificationCaptureBody capture={capture} />
    </StepScreen>
  );
}
