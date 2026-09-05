import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { ThemedText } from '@/components/themed-text';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { useCitySearch } from '@/features/trips/hooks';
import { useTheme } from '@/hooks/use-theme';
import type { CityRow } from '@/lib/database.types';

/**
 * A city typed once, spelled the same way by everybody who types it.
 *
 * The app applies proper reference-data discipline to the city a traveler is
 * going TO and none at all to the city they are FROM, and the split falls
 * along language lines: München, Munich, Munique and Monaco di Baviera are
 * four unrelated strings for one place, so two people from the same city
 * never turn up as being from the same city. Same `search_cities` RPC as
 * add-trip, accent folded both ways, so "sao paulo" finds São Paulo.
 *
 * IT STAYS A TEXT FIELD, and that is the design rather than a shortcut. A
 * home city the reference table does not carry still has to be expressible,
 * the columns behind it are text, and nothing about a suggestion list makes
 * them not. Picking is the fast path; typing is always allowed.
 *
 * ONE COMPONENT, because the alternative already failed twice. The typeahead
 * was built into the signup form alone, so the only people it could ever help
 * were the ones who had not signed up yet, and the edit form beside it went
 * on storing free text - which is the drift the shared spelling exists to
 * prevent, reintroduced by the fix for it. Then this file was extracted and
 * signup kept its hand-rolled copy anyway, and within one change the two had
 * already parted: the inline rows carried no minHeight, which put them near
 * 39pt against a 44pt floor, on a different ground colour, under a comment
 * claiming they matched a third list they matched in neither. **Both home-city
 * forms mount this** - src/app/onboarding/index.tsx step 4 and
 * src/app/edit-profile.tsx - and a third is not to be written.
 *
 * ADD-TRIP IS NOT ONE OF THEM, and that is the contract rather than an
 * oversight. Its field answers with a `CityRow | null` because a trip needs a
 * city_id and a name nobody can resolve is not a trip; this one answers with
 * TEXT that a pick can fill in, because a home city the reference table does
 * not carry still has to be expressible. Same RPC, same duplicate-name rule,
 * different question - so they share `search_cities` and not a component.
 */
export function CityField({
  label,
  value,
  onChangeText,
  onPick,
  placeholder = 'Start typing: Lisbon, Bangkok, Mexico City',
  hint,
  testID,
  autoFocus = false,
}: {
  label: string;
  value: string;
  /** Typing. The picked country, if any, is the caller's to hold. */
  onChangeText: (next: string) => void;
  /**
   * A row from the reference table. The caller takes the country from it too:
   * that is the half that makes 'Deutschland', 'Germany' and 'DE' one country
   * instead of three.
   */
  onPick: (city: CityRow) => void;
  placeholder?: string;
  hint?: string;
  testID?: string;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  /**
   * Whether the field is being TYPED IN, as opposed to holding a saved
   * answer.
   *
   * Suggestions are gated on it because both forms that mount this are
   * prefilled: without it, opening Edit profile shows a list of cities
   * hanging under a value nobody touched.
   */
  const [typing, setTyping] = useState(false);
  const { data: suggestions = [] } = useCitySearch(typing ? value : '');

  return (
    <>
      <FormTextField
        label={label}
        testID={testID}
        placeholder={placeholder}
        hint={hint}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoComplete="off"
        value={value}
        onChangeText={(next) => {
          onChangeText(next);
          setTyping(true);
        }}
        // Return means "that is the one I meant", whether or not it is on the
        // list, so it puts the list away. Not onBlur: with
        // keyboardShouldPersistTaps="always" a tap on a suggestion does not
        // blur the field, but leaning on that is how autocompletes end up
        // unmounting the row under the finger that is pressing it.
        returnKeyType="done"
        onSubmitEditing={() => setTyping(false)}
      />
      {suggestions.map((suggestion) => {
        // Five US Springfields exist: show the admin region when a name
        // repeats within the result set. Same rule add-trip uses, so no two
        // city lists in the app can disagree about which Springfield is which.
        const duplicated =
          suggestions.filter(
            (other) =>
              other.name === suggestion.name && other.country_code === suggestion.country_code
          ).length > 1;
        return (
          <Pressable
            key={suggestion.id}
            accessibilityRole="button"
            accessibilityLabel={`${suggestion.name}, ${suggestion.country_name}`}
            // The box IS the Pressable, rather than a styled View inside one.
            // The 44pt floor below is a claim about the area a thumb can hit,
            // and a row whose padding lives on a child is a row whose hit area
            // is whatever the child happened to lay out to.
            style={[styles.suggestion, { backgroundColor: theme.backgroundElement }]}
            onPress={() => {
              onPick(suggestion);
              setTyping(false);
            }}>
            <ThemedText>
              {suggestion.name}
              <ThemedText themeColor="textSecondary">
                {duplicated && suggestion.admin ? `, ${suggestion.admin}` : ''},{' '}
                {suggestion.country_name}
              </ThemedText>
            </ThemedText>
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  /* One city from search_cities. The fill is the field's own, by token name
     and not by luck, so the list reads as part of the box above it. */
  suggestion: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
});
