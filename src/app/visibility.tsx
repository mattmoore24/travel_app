import { router } from 'expo-router';

import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import {
  AUDIENCE_BOTH_WAYS,
  AUDIENCE_GENDER_NOTE,
  AUDIENCE_NEEDS_BADGE,
} from '@/features/profile/audience';
import { AudiencePicker } from '@/features/profile/audience-picker';
import { useOwnProfile, useOwnVisibility, useSetVisibility } from '@/features/profile/hooks';

/**
 * Who can see you, on the map and in Travelers.
 *
 * Three things this screen says out loud, because all three surprise people
 * who are not told: it cuts both ways, it does nothing to chat, and the
 * gendered options match the gender on a profile, so anyone who has not set
 * one is in none of them. Said once here beats being found out later as a
 * bug report.
 *
 * The rows themselves and every string on them now live in
 * features/profile/audience-picker, because signup asks the same question and
 * two copies of "only verified women see you" is how one of them ends up
 * subtly wrong.
 */
export default function VisibilityScreen() {
  const { data: profile } = useOwnProfile();
  const { data: audience = 'everyone' } = useOwnVisibility();
  const save = useSetVisibility();
  const verified = profile?.verified === true;

  return (
    <StepScreen
      title="Who you see, and who sees you"
      subtitle={AUDIENCE_BOTH_WAYS}
      continueLabel="Done"
      onContinue={() => router.back()}>
      {/* ABOVE the rows, not below them. It used to render last, where the
          StepScreen footer is a SIBLING of the scroll view — so the sentence
          was clipped mid-word at the scroll viewport edge behind Done, and
          no amount of bottom padding could fix a line the viewport cuts. */}
      <ThemedText type="footnote" themeColor="textSecondary">
        {AUDIENCE_GENDER_NOTE}
      </ThemedText>

      <AudiencePicker
        value={audience}
        verified={verified}
        disabled={save.isPending}
        onChange={(next) => save.mutate(next)}
        onLockedPress={() => router.push('/verification')}
      />

      {/* The consequence, said before it is discovered. A narrowed audience
          empties the Travelers queue and thins the map, and being told that
          here is the difference between a working filter and a broken app. */}
      {audience !== 'everyone' ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          While this is on, expect fewer travelers in Travelers and fewer pins on the map.
        </ThemedText>
      ) : null}

      {/* Directly under the rows, ABOVE the explanation below it. The
          explanation went in first and pushed this off the bottom of a 6.1"
          screen, which buried the one button that does anything for the
          person reading it. E2E run 55 photographed that. */}
      {verified ? null : (
        <>
          <ThemedText type="footnote" themeColor="textSecondary">
            {AUDIENCE_NEEDS_BADGE}
          </ThemedText>
          <PrimaryButton
            variant="ghost"
            label="Get verified"
            onPress={() => router.push('/verification')}
          />
        </>
      )}
    </StepScreen>
  );
}
