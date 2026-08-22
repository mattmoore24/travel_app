import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { HitTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The verified badge, everywhere it appears.
 *
 * It used to be a bare icon with no label and no explanation: under VoiceOver
 * it was an unnamed image next to a name, and to everybody else it was a
 * blue tick that could plausibly have meant "paid", "staff" or nothing at
 * all. For an app that ends in two strangers meeting in a real city, what
 * this badge means is worth one sentence.
 *
 * The label folds the name and age in on purpose, so VoiceOver reads
 * "Theo, 29, verified" as one phrase rather than announcing an image
 * separately from the text beside it.
 */
export function VerifiedSeal({
  size = 14,
  /** Who this is about, so the spoken label is a sentence. */
  name,
  age,
  /** White on a photo scrim, accent on a surface. */
  onPhoto = false,
}: {
  size?: number;
  name?: string | null;
  age?: number | null;
  onPhoto?: boolean;
}) {
  const theme = useTheme();
  const who = [name, age != null ? String(age) : null].filter(Boolean).join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={who ? `${who}, verified` : 'Verified'}
      accessibilityHint="What the verified badge means"
      // Sized from the glyph, not guessed. A flat 10 gave a 34pt target on
      // the 14pt seal and 40pt on the 20pt one, both under the 44 every
      // other small control in this app buys itself — and this is a control
      // people reach for exactly once, on somebody else's face, to find out
      // whether the badge means anything.
      hitSlop={Math.max(0, Math.ceil((HitTarget - size) / 2))}
      onPress={() =>
        Alert.alert(
          'Verified',
          'Photo-verified with a live selfie. We compared it against their profile photos, and the selfie was deleted after the check.'
        )
      }
      style={styles.target}>
      <SymbolView
        name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
        size={size}
        tintColor={onPhoto ? '#FFFFFF' : theme.tint}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
