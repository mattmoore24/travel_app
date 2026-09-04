import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { KeyboardDone } from '@/components/form/keyboard-done-bar';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Type, Elevation, Fonts, HitTarget, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { usePlaceSearch } from '@/features/pins/use-place-search';
import { venueSearchAvailable, type LocalSearchResult } from '@/modules/local-search';

type PinSearchFieldProps = {
  cityName: string;
  cityLat: number;
  cityLng: number;
  /**
   * The whole place, not just where it is. The pin form fills its own
   * location block from this, so nobody retypes what the map already knows.
   */
  onFound: (place: LocalSearchResult) => void;
};

/**
 * Find the place you're planning to be, by typing its name.
 *
 * Suggestions arrive as you type — no button to hunt for, which is what
 * everyone expects from a search field and what the founder asked for after
 * using it. Two things this has to get right that a naive typeahead does not:
 *
 *   1. **Stale responses.** A slow request for "tim" must not overwrite the
 *      results for "time out market" just because it landed later. Every
 *      search carries a sequence number and anything but the newest is
 *      dropped on arrival.
 *   2. **Honest emptiness.** "No results yet" and "there is genuinely nothing
 *      by that name here" look identical unless you say which is which.
 *
 * Panning the map by hand stays the first-class way to place a pin; this is
 * the shortcut.
 */
export function PinSearchField({ cityName, cityLat, cityLng, onFound }: PinSearchFieldProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const { hits, message, searching, clear, minQuery } = usePlaceSearch({
    query,
    cityName,
    cityLat,
    cityLng,
  });

  // Clearing happens on the keystroke, not in an effect: it is a response to
  // what the user just did, and doing it here keeps the effect in the hook
  // free of synchronous state writes.
  const onChangeText = (text: string) => {
    setQuery(text);
    if (text.trim().length < minQuery) {
      clear();
    }
  };

  const pick = (result: LocalSearchResult) => {
    haptics.light();
    inputRef.current?.blur();
    clear();
    setQuery('');
    // The venue's own name, address and category go into the pin, so
    // "Pensão Amor" arrives spelled the way the map spells it and nobody is
    // asked what kind of place it is.
    onFound(result);
  };

  const showClear = query.length > 0;

  return (
    <View style={styles.wrap}>
      {/* Opaque, not glass: a text field inside a UIVisualEffectView never
          receives the tap that would focus it. */}
      <View style={[styles.row, Elevation.floating, { backgroundColor: theme.surface }]}>
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={17}
          tintColor={message ? theme.danger : theme.textSecondary}
        />
        <KeyboardDone>
          {(done) => (
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={onChangeText}
              placeholder={
                venueSearchAvailable ? `Search ${cityName}` : `Street or area in ${cityName}`
              }
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="words"
              clearButtonMode="never"
              // The Search key blurs, but nothing on screen said so, and "Pin
              // here" sits underneath the keyboard the whole time somebody is
              // typing. A labelled Done is the same affordance the pin form one
              // step later already uses.
              {...done}
              accessibilityLabel={`Search ${cityName}`}
              testID="pin-search-input"
              style={[styles.input, { color: theme.text, fontFamily: Fonts?.sans }]}
            />
          )}
        </KeyboardDone>
        {searching ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
        {showClear && !searching ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
            // Through onChangeText, not setQuery: onChangeText is the only
            // thing that also clears the hits and the "nothing by that name"
            // line, so clearing by hand used to leave a stale dropdown over
            // the map above an empty field claiming nothing was searched.
            onPress={() => {
              onChangeText('');
              inputRef.current?.focus();
            }}>
            <SymbolView
              name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
              size={17}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      {hits.length > 0 ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(100)}
          style={[styles.results, { backgroundColor: theme.surface }, Elevation.floating]}>
          {hits.map((hit, i) => (
            <PressableScale
              key={`${hit.name}:${hit.latitude}:${hit.longitude}`}
              accessibilityRole="button"
              accessibilityLabel={hit.name}
              haptic="selection"
              scaleTo={0.99}
              onPress={() => pick(hit)}
              style={[
                styles.result,
                i > 0
                  ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline }
                  : null,
              ]}>
              <ThemedText numberOfLines={1}>{hit.name}</ThemedText>
              {hit.address || hit.locality ? (
                <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                  {[hit.address, hit.locality].filter(Boolean).join(', ')}
                </ThemedText>
              ) : null}
            </PressableScale>
          ))}
        </Animated.View>
      ) : null}

      {message ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          style={[styles.message, { backgroundColor: theme.surface }, Elevation.raised]}>
          <ThemedText type="footnote" themeColor="textSecondary">
            {message}
          </ThemedText>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingLeft: Space.lg,
    paddingRight: Space.lg,
    height: HitTarget + 6,
    borderRadius: Radius.pill,
  },
  input: {
    flex: 1,
    fontSize: Type.body.fontSize,
    paddingVertical: 0,
  },
  message: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  results: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  result: {
    gap: 2,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
});
