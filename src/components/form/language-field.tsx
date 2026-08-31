import { SymbolView } from 'expo-symbols';
import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { LANGUAGES, languageLabel, matchesLanguage } from '@/constants/languages';
import { Type, Fonts, HitTarget, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

type Language = (typeof LANGUAGES)[number];

/**
 * Every language, searchable, multi-select, English at the top.
 *
 * It used to be a wrapping row of twenty-four chips, which is fine until the
 * language you speak is not one of the twenty-four. A list this long has to
 * be a sheet with a search field: a row of two hundred chips is not a
 * control, it is a wall.
 */
export function LanguageField({
  selected,
  onChange,
  max,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const search = useRef<TextInput>(null);

  const listHeight = Math.min(420, Math.max(240, height * 0.45));

  const rows = useMemo(() => {
    const matching = LANGUAGES.filter((l) => matchesLanguage(l, query));
    if (query.trim().length > 0) {
      return matching as readonly Language[];
    }
    // With no search, what you already picked sits at the top so you can see
    // and undo it without hunting through two hundred rows.
    const picked = matching.filter((l) => selected.includes(l.value));
    const restLanguages = matching.filter((l) => !selected.includes(l.value));
    return [...picked, ...restLanguages];
  }, [query, selected]);

  const atMax = selected.length >= max;

  const toggle = (code: string) => {
    if (selected.includes(code)) {
      haptics.selection();
      onChange(selected.filter((c) => c !== code));
      return;
    }
    if (atMax) {
      // A limit, not a destruction. `warning` is the destructive-confirmation
      // word (unsend, leave, take a pin down), and refusing an eighth
      // language is not that.
      haptics.selection();
      return;
    }
    haptics.selection();
    onChange([...selected, code]);
  };

  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Languages you speak"
        accessibilityHint="Opens a searchable list"
        haptic="selection"
        scaleTo={0.99}
        // Same reason as select-field: onboarding reaches this with City or
        // Country focused, and a sheet presented over a live keyboard has
        // the bottom of its list behind it.
        onPress={() => {
          Keyboard.dismiss();
          setQuery('');
          setOpen(true);
        }}
        style={[styles.field, { backgroundColor: theme.surfaceSunken }]}>
        <View style={styles.fieldText}>
          {selected.length === 0 ? (
            <ThemedText themeColor="textSecondary">Pick the ones you speak</ThemedText>
          ) : (
            <View style={styles.chips}>
              {selected.map((code) => (
                <View key={code} style={[styles.chip, { backgroundColor: theme.accentSoft }]}>
                  <ThemedText type="footnote">{languageLabel(code)}</ThemedText>
                </View>
              ))}
            </View>
          )}
        </View>
        <SymbolView
          name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
          size={14}
          tintColor={theme.textSecondary}
          {...keyboardDoneProps}
        />
      </PressableScale>

      {open ? (
        <Sheet onClose={() => setOpen(false)} avoidKeyboard>
          <View style={styles.sheetHeader}>
            <ThemedText type="headline">Languages</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done"
              hitSlop={10}
              onPress={() => setOpen(false)}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Done
              </ThemedText>
            </Pressable>
          </View>

          {/* Opaque, never glass: a field inside a visual-effect view cannot
              be focused at all (see the traps skill). */}
          <View style={[styles.searchRow, { backgroundColor: theme.surfaceSunken }]}>
            <SymbolView
              name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              size={16}
              tintColor={theme.textSecondary}
            />
            <TextInput
              ref={search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search languages"
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              accessibilityLabel="Search languages"
              testID="language-search"
              style={[styles.searchInput, { color: theme.text, fontFamily: Fonts?.sans }]}
            />
          </View>

          <ThemedText type="footnote" themeColor="textSecondary">
            {selected.length} of {max} picked
            {atMax ? '. Take one off to add another.' : ''}
          </ThemedText>

          <FlatList
            style={{ height: listHeight }}
            data={rows}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <ThemedText themeColor="textSecondary" style={styles.empty}>
                No language by that name. Try the name in English.
              </ThemedText>
            }
            renderItem={({ item }) => {
              const isSelected = selected.includes(item.value);
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={item.label}
                  // The search box above holds the same word somebody just
                  // typed, so driving this row by its label matches two
                  // elements and the suite taps the field instead. Run 86
                  // reached step 5 with no language chosen because of it.
                  testID={`language-option-${item.value}`}
                  accessibilityState={{ checked: isSelected, disabled: !isSelected && atMax }}
                  onPress={() => toggle(item.value)}
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: theme.hairline },
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <View style={styles.rowText}>
                    <ThemedText
                      style={!isSelected && atMax ? { color: theme.textSecondary } : undefined}>
                      {item.label}
                    </ThemedText>
                    {item.native !== item.label ? (
                      <ThemedText type="footnote" themeColor="textSecondary">
                        {item.native}
                      </ThemedText>
                    ) : null}
                  </View>
                  {isSelected ? (
                    <SymbolView
                      name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                      size={16}
                      tintColor={theme.accent}
                    />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </Sheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: HitTarget + 6,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  fieldText: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.xs,
  },
  chip: {
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    height: HitTarget,
    paddingHorizontal: Space.md,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  searchInput: {
    flex: 1,
    fontSize: Type.body.fontSize,
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget,
    paddingVertical: Space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
  },
  empty: {
    paddingVertical: Space.lg,
  },
});
