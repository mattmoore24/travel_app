import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AccountKind = 'traveler' | 'business';

/**
 * Which kind of account this is, asked before anything else is typed.
 *
 * Founder, 2026-08-28: "It should be clear right from the start if you are
 * creating or signing into a business account or an individual account."
 *
 * It used to be neither asked nor shown. The only door to a business account
 * was one line on the last page of the welcome tour, so anybody who reached
 * signup any other way had no idea the choice existed, and somebody who ran a
 * bar typed their email into a form that was quietly building them a traveler
 * profile. Worse, finishing that profile is what permanently blocks them:
 * `register_business` refuses an account that has completed traveler
 * onboarding.
 *
 * Two rows rather than a segmented control. A segment fits two words and this
 * choice needs a sentence each: the words "traveler" and "business" do not by
 * themselves tell somebody what they are about to get.
 */
export function AccountKindChoice({
  value,
  onChange,
}: {
  value: AccountKind;
  onChange: (next: AccountKind) => void;
}) {
  return (
    <View style={styles.block}>
      <ThemedText type="caption" themeColor="textSecondary">
        What are you signing up as?
      </ThemedText>
      <Row
        kind="traveler"
        value={value}
        onChange={onChange}
        glyph={{ ios: 'figure.walk', android: 'hiking', web: 'hiking' }}
        title="I'm travelling"
        detail="A profile, the map, and people to meet."
      />
      <Row
        kind="business"
        value={value}
        onChange={onChange}
        glyph={{ ios: 'building.2.fill', android: 'storefront', web: 'storefront' }}
        title="I run a business"
        detail="A listing on the map, and travelers who can message you."
      />
    </View>
  );
}

function Row({
  kind,
  value,
  onChange,
  glyph,
  title,
  detail,
}: {
  kind: AccountKind;
  value: AccountKind;
  onChange: (next: AccountKind) => void;
  glyph: SymbolViewProps['name'];
  title: string;
  detail: string;
}) {
  const theme = useTheme();
  const selected = value === kind;
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityState={{ selected }}
      haptic="selection"
      scaleTo={0.98}
      onPress={() => onChange(kind)}>
      <ThemedView
        type={selected ? 'accentSoft' : 'backgroundElement'}
        style={[styles.row, { borderColor: selected ? theme.accent : 'transparent' }]}>
        <SymbolView
          name={glyph}
          size={20}
          tintColor={selected ? theme.accent : theme.textSecondary}
        />
        <View style={styles.rowText}>
          <ThemedText type="smallBold">{title}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {detail}
          </ThemedText>
        </View>
        <SymbolView
          name={
            selected
              ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
              : { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' }
          }
          size={20}
          tintColor={selected ? theme.accent : theme.textSecondary}
        />
      </ThemedView>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
});
