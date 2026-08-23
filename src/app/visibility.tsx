import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { useOwnProfile, useOwnVisibility, useSetVisibility } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { ProfileAudience } from '@/lib/database.types';

const OPTIONS: { value: ProfileAudience; label: string; detail: string }[] = [
  { value: 'everyone', label: 'Everyone', detail: 'Anyone travelling where you are' },
  { value: 'verified', label: 'Verified only', detail: 'People who passed the selfie check' },
  { value: 'verified_men', label: 'Verified men', detail: 'Verified, and men' },
  { value: 'verified_women', label: 'Verified women', detail: 'Verified, and women' },
  {
    value: 'verified_nonbinary',
    label: 'Verified non-binary',
    detail: 'Verified, and non-binary',
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
      title="Who can see you"
      subtitle="Your profile and your pins, on the map and in Travelers. Chat is not affected: anyone can still message you."
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
            accessibilityLabel={`${option.label}. ${option.detail}`}
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
              <ThemedText type="callout">{option.label}</ThemedText>
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

      {verified ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          It works both ways. Pick verified women and that is who sees you, and who you see. The
          gendered ones match the gender on a profile, so anyone who has not set one is in none of
          them.
        </ThemedText>
      ) : (
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
