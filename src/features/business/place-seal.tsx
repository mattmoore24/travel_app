import { SymbolView } from 'expo-symbols';
import { Alert, Pressable } from 'react-native';

import { HitTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const SEAL = 14;

/**
 * The check beside a place's name.
 *
 * Its own control rather than `VerifiedSeal`, which explains a live SELFIE
 * checked against a profile: true of a traveler, false of a bar, and a badge
 * that explains itself wrongly is worse than one that says nothing. The
 * spoken label is "Verified place" and never "verified business", because
 * that word is back-office vocabulary a traveler never meets.
 *
 * Its own FILE because three screens show it — the sheet, the place page and
 * the owner's dashboard — and for a while they each grew their own, with
 * three different titles and two different sentences one tap apart. Two
 * badges explaining themselves differently is how a signal stops being one.
 *
 * There is deliberately no counterpart for a place without the check. An
 * "unverified" chip would be a mark against every honest place that has not
 * got round to standing outside with a phone yet.
 */
export function PlaceSeal() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Verified place"
      accessibilityHint="What the verified check means"
      hitSlop={Math.ceil((HitTarget - SEAL) / 2)}
      onPress={() =>
        Alert.alert(
          'Verified place',
          'Somebody stood outside and sent us two photos of the front. We checked them against the spot on the map.'
        )
      }>
      <SymbolView
        name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
        size={SEAL}
        tintColor={theme.accent}
      />
    </Pressable>
  );
}
