import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { AUDIENCE_LABEL } from '@/features/profile/audience';
import { useOwnProfile, useOwnVisibility, useSetVisibility } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { ProfileAudience } from '@/lib/database.types';

// Every detail line names BOTH directions. They used to describe a set
// ("People who passed the selfie check"), which reads as a one-way filter on
// what you are shown, and the founder tested it believing exactly that. The
// detail is also the VoiceOver label for the row, so a one-way description
// was the only thing a VoiceOver user got.
const OPTIONS: { value: ProfileAudience; detail: string }[] = [
  { value: 'everyone', detail: 'No filter, either way' },
  {
    value: 'verified',
    detail: 'Only verified travelers see you, and they are the only ones you see',
  },
  {
    value: 'verified_men',
    detail: 'Only verified men see you, and they are the only ones you see',
  },
  {
    value: 'verified_women',
    detail: 'Only verified women see you, and they are the only ones you see',
  },
  {
    value: 'verified_nonbinary',
    detail: 'Only verified non-binary travelers see you, and they are the only ones you see',
  },
];

/**
 * Who can see you, on the map and in Travelers.
 *
 * Three things this screen says out loud, because all three surprise people
 * who are not told: it cuts both ways, it does nothing to chat, and the
 * gendered options match the gender on a profile, so anyone who has not set
 * one is in none of them. Said once here beats being found out later as a
 * bug report.
 */
export default function VisibilityScreen() {
  const theme = useTheme();
  const { data: profile } = useOwnProfile();
  const { data: audience = 'everyone' } = useOwnVisibility();
  const save = useSetVisibility();
  const verified = profile?.verified === true;

  const pick = (next: ProfileAudience) => {
    // The server refuses an unverified traveler too. The row is simply not
    // live, so nobody taps something that then tells them off.
    if (next === audience || save.isPending || (next !== 'everyone' && !verified)) {
      return;
    }
    haptics.selection();
    save.mutate(next);
  };

  return (
    <StepScreen
      title="Who you see, and who sees you"
      subtitle="One setting, both ways. Only the people you pick can see you, and they are the only people you see on the map and in Travelers. Chat is separate: anyone can still message you."
      continueLabel="Done"
      onContinue={() => router.back()}>
      {OPTIONS.map((option) => {
        const locked = option.value !== 'everyone' && !verified;
        const active = option.value === audience;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: locked }}
            accessibilityLabel={`${AUDIENCE_LABEL[option.value]}. ${option.detail}`}
            scaleTo={locked ? 1 : 0.985}
            onPress={() => pick(option.value)}
            style={[
              styles.row,
              {
                backgroundColor: active ? theme.accentSoft : theme.surfaceSunken,
                opacity: locked ? 0.45 : 1,
              },
            ]}>
            <View style={styles.rowText}>
              <ThemedText type="callout">{AUDIENCE_LABEL[option.value]}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {option.detail}
              </ThemedText>
            </View>
            {active ? (
              <SymbolView
                name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                size={16}
                tintColor={theme.accent}
              />
            ) : null}
          </PressableScale>
        );
      })}

      {/* Unconditional. The both-ways rule used to live in here inside the
          `verified` branch, which hid it from exactly the person deciding
          whether the badge is worth a selfie. */}
      <ThemedText type="footnote" themeColor="textSecondary">
        Verified means they passed the selfie check. The three gendered options go by the gender on
        a profile, so anyone who has not set one is in none of them.
      </ThemedText>

      {/* The consequence, said before it is discovered. A narrowed audience
          empties the Travelers queue and thins the map, and being told that
          here is the difference between a working filter and a broken app. */}
      {audience !== 'everyone' ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          While this is on, expect fewer travelers in Travelers and fewer pins on the map.
        </ThemedText>
      ) : null}

      {verified ? null : (
        <>
          <ThemedText type="footnote" themeColor="textSecondary">
            You need the badge before you can ask other people for one.
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

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: HitTarget,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  rowText: {
    flex: 1,
  },
});
