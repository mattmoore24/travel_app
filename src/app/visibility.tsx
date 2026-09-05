import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Space } from '@/constants/theme';
import { GROUP_ADD_OPTIONS, useGroupAdds, useSetGroupAdds } from '@/features/groups/adds';
import { useTheme } from '@/hooks/use-theme';
import {
  AUDIENCE_BOTH_WAYS,
  AUDIENCE_GENDER_NOTE,
  AUDIENCE_NEEDS_BADGE,
} from '@/features/profile/audience';
import { AudiencePicker } from '@/features/profile/audience-picker';
import {
  useOwnGuestPreview,
  useOwnProfile,
  useOwnVisibility,
  useSetGuestPreview,
  useSetVisibility,
} from '@/features/profile/hooks';

/**
 * Who can see you, on the map and in Travelers.
 *
 * Three things this screen says out loud, because all three surprise people
 * who are not told: it cuts both ways, it does nothing to chat, and the
 * gendered options match the gender on a profile, so anyone who has not set
 * one is in none of them. Said once here beats being found out later as a
 * bug report.
 *
 * And a fourth, since D22: whether a device with NO ACCOUNT may be shown
 * your face. The audience rows above are the rule between two accounts. The
 * signed-out preview (three travelers per city, before the account wall) is
 * a different door, and it has its own row here, rendered only while the
 * audience is Everyone because a narrowed audience already keeps every
 * guest out (audience_admits, 20260823040000). It is enforced inside
 * featured_traveler (20260903080000), so it holds for the card call and the
 * face call alike, and it changes nothing for anybody who is signed in.
 *
 * The rows themselves and every string on them now live in
 * features/profile/audience-picker, because signup asks the same question and
 * two copies of "only verified women see you" is how one of them ends up
 * subtly wrong.
 */
export default function VisibilityScreen() {
  const theme = useTheme();
  const { data: profile } = useOwnProfile();
  const { data: audience = 'everyone' } = useOwnVisibility();
  const save = useSetVisibility();
  const { data: groupAdds = 'known' } = useGroupAdds();
  const setAdds = useSetGroupAdds();
  // Shown is the server's own default, so it is the screen's too: a row that
  // read "hidden" while the answer was still on its way would be a lie for
  // the length of a round trip.
  const { data: shownToGuests = true } = useOwnGuestPreview();
  const setPreview = useSetGuestPreview();
  const verified = profile?.verified === true;
  const previewLabel = shownToGuests
    ? 'Hide me from people without an account'
    : 'Show me to people without an account';

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

      {/* The signed-out preview (D22). Only while the audience is Everyone:
          under anything narrower a guest is already nobody, and a control
          that could not change anything would be a control that lies. A
          ghost button carrying the switch role rather than a platform
          Switch, for the reason notifications-row gives: this app has no
          Switch anywhere, and one control introduced for one row is a
          vocabulary of its own. */}
      {audience === 'everyone' ? (
        <View style={styles.previewBlock}>
          <ThemedText type="smallBold">Before somebody has an account</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {shownToGuests
              ? 'Anyone opening the app without an account can be shown up to three travelers with plans in a city: face, name, age and dates. You can be one of them.'
              : 'Only people with an account can see you. Anyone opening the app without one is shown other travelers, never you.'}
          </ThemedText>
          <PrimaryButton
            variant="ghost"
            label={previewLabel}
            accessibilityRole="switch"
            accessibilityState={{ checked: shownToGuests, disabled: setPreview.isPending }}
            // The same words that are written on it, so a Voice Control user
            // reading the button can say them and be heard.
            accessibilityLabel={previewLabel}
            disabled={setPreview.isPending}
            onPress={() => setPreview.mutate(!shownToGuests)}
          />
        </View>
      ) : null}

      {/* The second thing this screen decides, and the reason it belongs here:
          being added to a group is the one place the app's consent-before-
          exposure grammar used to break, and this is the screen a person looks
          on for "who can do what to me". Enforced in add_to_group, so it holds
          for any caller and not only for this one. */}
      <ThemedText type="smallBold">Who can add you to a group</ThemedText>
      <View style={styles.addRows}>
        {GROUP_ADD_OPTIONS.map((option) => {
          const active = option.value === groupAdds;
          return (
            <PressableScale
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: setAdds.isPending }}
              accessibilityLabel={`${option.label}. ${option.detail}`}
              haptic="selection"
              scaleTo={0.985}
              disabled={setAdds.isPending || active}
              onPress={() => setAdds.mutate(option.value)}
              style={[
                styles.addRow,
                { backgroundColor: active ? theme.accentSoft : theme.surfaceSunken },
              ]}>
              <View style={styles.addRowText}>
                <ThemedText type="callout">{option.label}</ThemedText>
                {/* The consequence said out loud, the way the audience block
                    above already says its own. */}
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
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  previewBlock: {
    gap: Space.xs,
  },
  addRows: {
    gap: Space.sm,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  addRowText: {
    flex: 1,
    gap: 2,
  },
});
