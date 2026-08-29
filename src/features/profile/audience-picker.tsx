import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { AUDIENCE_LABEL, AUDIENCE_OPTIONS } from '@/features/profile/audience';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { ProfileAudience } from '@/lib/database.types';

/**
 * The five audience rows, wherever the choice is offered.
 *
 * Two screens ask it now: the picker reached from the profile, and the step
 * during profile creation. One component so a row cannot say one thing in
 * signup and another in settings.
 */
export function AudiencePicker({
  value,
  verified,
  disabled = false,
  onChange,
}: {
  value: ProfileAudience;
  /**
   * Whether this account has the badge. The narrowed options are inert
   * without it — the server refuses them too, and a row that is simply not
   * live beats one that tells you off after you tap it.
   */
  verified: boolean;
  disabled?: boolean;
  onChange: (next: ProfileAudience) => void;
}) {
  const theme = useTheme();

  const pick = (next: ProfileAudience) => {
    if (next === value || disabled || (next !== 'everyone' && !verified)) {
      return;
    }
    haptics.selection();
    onChange(next);
  };

  return (
    <View style={styles.list}>
      {AUDIENCE_OPTIONS.map((option) => {
        const locked = option.value !== 'everyone' && !verified;
        const active = option.value === value;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: locked || disabled }}
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
    </View>
  );
}

/**
 * The setting as one row, at the top of your own profile.
 *
 * Founder: "make the selection option of which users you want to see and
 * which can see you more prominent on the users profile. I'd put it right at
 * the top as a key selector as I imagine all users will want to have this set
 * properly."
 *
 * It was a ghost button at the bottom of a long page, below Edit profile and
 * Get verified, which is where somebody finds a setting by accident rather
 * than on purpose. It shows the current value, because a control that does
 * not say what it is currently set to is not a selector, it is a link.
 */
export function AudienceCard({
  audience,
  onPress,
}: {
  audience: ProfileAudience;
  onPress: () => void;
}) {
  const theme = useTheme();
  const narrowed = audience !== 'everyone';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Who you see, and who sees you. Currently ${AUDIENCE_LABEL[audience]}.`}
      accessibilityHint="Opens the audience picker"
      haptic="light"
      scaleTo={0.99}
      onPress={onPress}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.surfaceSunken,
            borderColor: narrowed ? theme.accent : 'transparent',
          },
        ]}>
        <View
          style={[
            styles.cardGlyph,
            { backgroundColor: narrowed ? theme.accentSoft : theme.surface },
          ]}>
          <SymbolView
            name={
              narrowed
                ? {
                    ios: 'eye.trianglebadge.exclamationmark',
                    android: 'visibility',
                    web: 'visibility',
                  }
                : { ios: 'eye', android: 'visibility', web: 'visibility' }
            }
            size={18}
            tintColor={narrowed ? theme.accent : theme.textSecondary}
          />
        </View>
        <View style={styles.cardText}>
          <ThemedText type="caption" themeColor="textSecondary">
            WHO YOU SEE, AND WHO SEES YOU
          </ThemedText>
          <ThemedText type="headline">{AUDIENCE_LABEL[audience]}</ThemedText>
        </View>
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={13}
          tintColor={theme.textSecondary}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Space.sm,
  },
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  cardGlyph: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
});
