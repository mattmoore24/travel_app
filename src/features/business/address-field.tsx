import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { KeyboardDone } from '@/components/form/keyboard-done-bar';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, Fonts, HitTarget, Radius, Space, Type } from '@/constants/theme';
import { usePlaceSearch } from '@/features/pins/use-place-search';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { LocalSearchResult } from '@/modules/local-search';

/**
 * A business typing its own address, anywhere on earth.
 *
 * Deliberately not PinSearchField, though it shares that screen's search
 * through `usePlaceSearch`. A traveler's field empties when they pick a
 * venue, because the pin form below then shows what was picked. A business is
 * typing the ADDRESS ITSELF, so the words have to stay in the box, and the
 * parent owns them: the founder's rule is that moving the marker afterwards
 * leaves the address exactly as it was, which is only expressible if the two
 * are separate pieces of state.
 *
 * Picking a suggestion sets both. Typing sets only the words. Dragging the
 * map sets only the marker. That is the whole contract. Two more rules since
 * 2026-09-05: the search runs only while the box has focus, so a screen that
 * mounts with an address (walking back from "Is this right?") never pops a
 * list under a settled one; and the city is not this field's business. No
 * city is chosen anywhere on the screen; the server files the listing under
 * the city its marker is in, and says so a line under the map.
 */
export function BusinessAddressField({
  value,
  near,
  onChangeText,
  onPick,
  onFocusChange,
  onSetPin,
}: {
  value: string;
  /** A marker the person already placed, to favour that neighbourhood. */
  near?: { lat: number; lng: number } | null;
  onChangeText: (next: string) => void;
  /** A result from the map: worth both the words and the coordinates. */
  onPick: (place: LocalSearchResult) => void;
  /**
   * The small line under the box, for an address that is not coming up.
   * Given the nearest miss the list had (the first suggestion's coordinate),
   * or null, so the map it opens can start somewhere sensible. Rendered only
   * while there is no marker yet; the parent stops passing it once there is.
   */
  onSetPin?: (near: { lat: number; lng: number } | null) => void;
  /**
   * Focused, so the step can get out of the way.
   *
   * With the keyboard up there is about one field's worth of room left on a
   * phone, and this list was landing in it: run 79 photographed the first
   * suggestion sliced in half by the docked button, under a line telling
   * somebody to pick a suggestion or drag a marker that was three screens
   * further down. The step hides its chips and its map while this is true.
   */
  onFocusChange?: (focused: boolean) => void;
}) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  // Off while the value came from a pick, so echoing the chosen address back
  // into the field does not immediately search for itself and reopen the list
  // under the user's thumb. Seeded from the value: a field that mounts with
  // an address already in it is showing one back, not typing one.
  const [picked, setPicked] = useState(value.length > 0);
  const [focused, setFocused] = useState(false);

  const { hits, message, searching, clear, minQuery } = usePlaceSearch({
    query: value,
    anywhere: true,
    near: near ?? null,
    enabled: !picked && focused,
  });

  const change = (text: string) => {
    setPicked(false);
    onChangeText(text);
    if (text.trim().length < minQuery) {
      clear();
    }
  };

  const pick = (result: LocalSearchResult) => {
    haptics.light();
    inputRef.current?.blur();
    onFocusChange?.(false);
    clear();
    setPicked(true);
    onPick(result);
  };

  return (
    <View style={styles.wrap}>
      <ThemedText type="callout">Address</ThemedText>
      {/* Opaque, not glass: a text field inside a UIVisualEffectView never
          receives the tap that would focus it. */}
      <View style={[styles.row, { backgroundColor: theme.surfaceSunken }]}>
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={17}
          tintColor={message ? theme.danger : theme.textSecondary}
        />
        <KeyboardDone>
          {(done) => (
            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={change}
              placeholder="Street, number and city"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              onFocus={() => {
                setFocused(true);
                onFocusChange?.(true);
              }}
              onBlur={() => {
                setFocused(false);
                onFocusChange?.(false);
              }}
              autoCorrect={false}
              autoCapitalize="words"
              clearButtonMode="never"
              {...done}
              accessibilityLabel="Your address"
              testID="business-address-input"
              style={[styles.input, { color: theme.text, fontFamily: Fonts?.sans }]}
            />
          )}
        </KeyboardDone>
        {searching ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
        {value.length > 0 && !searching ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear the address"
            hitSlop={10}
            onPress={() => {
              change('');
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
              // The suggestion text repeats what is in the box above it, so
              // driving this by its words finds two matches. The index is
              // what a suite can aim at.
              testID={`address-suggestion-${i}`}
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
        <ThemedText type="footnote" themeColor="textSecondary">
          {message}
        </ThemedText>
      ) : null}

      {/* The other way in, in smaller text, right under whatever the search
          said. Reachable with the keyboard up: the step's own scroller keeps
          taps alive, and this sits inside the field's block rather than
          three screens down. Blurs first, hands over the nearest miss, and
          only then clears, so the map can open on the neighbourhood the
          search almost found. */}
      {onSetPin ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Not coming up? Set the pin yourself."
          testID="business-set-pin-yourself"
          haptic="light"
          scaleTo={0.98}
          style={styles.setPin}
          onPress={() => {
            inputRef.current?.blur();
            setFocused(false);
            onFocusChange?.(false);
            const first = hits[0];
            clear();
            onSetPin(first ? { lat: first.latitude, lng: first.longitude } : null);
          }}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Not coming up? Set the pin yourself.
          </ThemedText>
        </PressableScale>
      ) : null}
    </View>
  );
}

/**
 * The words a picked result puts in the box.
 *
 * MapKit's street line when it has one, and the matched name when it does
 * not — a POI search for "Casa Amarela" carries the street in `address` and
 * the venue in `name`, and it is the street a business is being asked for.
 */
export function addressFrom(place: LocalSearchResult): string {
  return (place.address?.trim() || place.name).slice(0, 160);
}

const styles = StyleSheet.create({
  wrap: {
    gap: Space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    minHeight: HitTarget,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  input: {
    flex: 1,
    fontSize: Type.body.fontSize,
    paddingVertical: Space.sm,
  },
  results: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  result: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    gap: 2,
  },
  // A footnote that is a button: the 44pt target the words alone would not
  // give, centred on it.
  setPin: {
    minHeight: HitTarget,
    justifyContent: 'center',
  },
});
