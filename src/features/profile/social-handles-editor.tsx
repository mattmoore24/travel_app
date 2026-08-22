import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Type, Fonts, HitTarget, Radius, Space } from '@/constants/theme';
import {
  useDeleteSocialHandle,
  useOwnSocialHandles,
  useUpsertSocialHandle,
} from '@/features/profile/hooks';
import { SocialLogo } from '@/features/profile/social-logo';
import { normalizeHandle, validateHandle } from '@/features/profile/validation';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { SocialPlatform } from '@/lib/database.types';

/** Every platform the column type allows, in the order people actually use. */
export const PLATFORMS: { value: SocialPlatform; label: string; at: boolean }[] = [
  { value: 'instagram', label: 'Instagram', at: true },
  { value: 'whatsapp', label: 'WhatsApp', at: false },
  { value: 'snapchat', label: 'Snapchat', at: true },
  { value: 'telegram', label: 'Telegram', at: true },
  { value: 'tiktok', label: 'TikTok', at: true },
  { value: 'x', label: 'X', at: true },
  { value: 'facebook', label: 'Facebook', at: false },
  { value: 'other', label: 'Something else', at: false },
];

const LABELS: Record<string, string> = Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label]));

/** What to call this platform out loud. One table, so the chat card, the
 * profile and the editor cannot drift into calling it three things. */
export function platformLabel(platform: SocialPlatform): string {
  return LABELS[platform] ?? platform;
}

/** WhatsApp is a number, Facebook is a name — an @ there would be wrong. */
/** Whether this platform's handles read as @names. Phone numbers and real
 * names do not, and printing an @ in front of one looks like a bug. */
export function usesAt(platform: SocialPlatform) {
  return PLATFORMS.find((p) => p.value === platform)?.at ?? false;
}

function placeholderFor(platform: SocialPlatform) {
  switch (platform) {
    case 'whatsapp':
      return 'Phone number';
    case 'facebook':
      return 'Name or link';
    case 'other':
      return 'Wherever people find you';
    default:
      return 'username';
  }
}

/**
 * Add one, add five, remove any — the whole thing is a tap on a logo and a
 * line of text. Handles are stored bare and only ever revealed through an
 * accepted chat, which the database enforces rather than this screen.
 */
export function SocialHandlesEditor() {
  const theme = useTheme();
  const { data: handles = [] } = useOwnSocialHandles();
  const upsert = useUpsertSocialHandle();
  const remove = useDeleteSocialHandle();

  const [adding, setAdding] = useState<SocialPlatform | null>(null);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  const taken = new Set(handles.map((h) => h.platform));
  const error = touched && value !== '' && adding ? validateHandle(value, usesAt(adding)) : null;

  const save = async (platform: SocialPlatform) => {
    setTouched(true);
    if (validateHandle(value, usesAt(platform)) != null) {
      return;
    }
    try {
      await upsert.mutateAsync({ platform, handle: normalizeHandle(value, usesAt(platform)) });
      haptics.success();
      setAdding(null);
      setValue('');
      setTouched(false);
    } catch {
      // Surfaced by the global mutation error alert; keep what was typed.
    }
  };

  return (
    <View style={styles.container}>
      {handles.length > 0 ? (
        <View style={styles.list}>
          {handles.map((row) => (
            <Animated.View
              key={row.id}
              layout={LinearTransition.springify()}
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}>
              <View style={[styles.row, { backgroundColor: theme.surfaceSunken }]}>
                <SocialLogo platform={row.platform} size={34} />
                <View style={styles.rowText}>
                  <ThemedText type="callout">{LABELS[row.platform] ?? row.platform}</ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {usesAt(row.platform) ? '@' : ''}
                    {row.handle}
                  </ThemedText>
                </View>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${LABELS[row.platform] ?? row.platform}`}
                  haptic="light"
                  scaleTo={0.9}
                  onPress={() => remove.mutate(row.id)}
                  style={styles.removeHit}>
                  <SymbolView
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={13}
                    tintColor={theme.textSecondary}
                  />
                </PressableScale>
              </View>
            </Animated.View>
          ))}
        </View>
      ) : null}

      {adding ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={[styles.addCard, { backgroundColor: theme.surfaceSunken }]}>
          <View style={styles.addHeader}>
            <SocialLogo platform={adding} size={34} />
            <ThemedText type="callout" style={styles.flex}>
              {LABELS[adding]}
            </ThemedText>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              haptic="light"
              scaleTo={0.9}
              onPress={() => {
                setAdding(null);
                setValue('');
                setTouched(false);
              }}
              style={styles.removeHit}>
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={13}
                tintColor={theme.textSecondary}
              />
            </PressableScale>
          </View>
          <View style={[styles.inputRow, { backgroundColor: theme.surface }]}>
            {/* The @ is furniture, not text: it is always there, never typed,
                and never part of what gets stored. */}
            {usesAt(adding) ? (
              <ThemedText themeColor="textSecondary" style={styles.at}>
                @
              </ThemedText>
            ) : null}
            <TextInput
              autoFocus
              value={value}
              onChangeText={setValue}
              placeholder={placeholderFor(adding)}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={adding === 'whatsapp' ? 'phone-pad' : 'default'}
              returnKeyType="done"
              onSubmitEditing={() => save(adding)}
              style={[styles.input, { color: theme.text, fontFamily: Fonts?.sans }]}
            />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Save"
              haptic="soft"
              scaleTo={0.94}
              disabled={value.trim() === '' || upsert.isPending}
              onPress={() => save(adding)}
              style={[
                styles.save,
                { backgroundColor: value.trim() === '' ? theme.hairline : theme.accent },
              ]}>
              <SymbolView
                name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                size={15}
                tintColor={value.trim() === '' ? theme.textSecondary : theme.onAccent}
              />
            </PressableScale>
          </View>
          {error ? (
            <ThemedText type="footnote" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          ) : null}
        </Animated.View>
      ) : null}

      {/* Every platform is one tap away — no dropdown to open first. */}
      <View style={styles.picker}>
        {PLATFORMS.filter((p) => !taken.has(p.value) && p.value !== adding).map((platform) => (
          <PressableScale
            key={platform.value}
            accessibilityRole="button"
            accessibilityLabel={`Add ${platform.label}`}
            haptic="selection"
            scaleTo={0.92}
            onPress={() => {
              setAdding(platform.value);
              setValue('');
              setTouched(false);
            }}
            style={styles.pickerItem}>
            <SocialLogo platform={platform.value} size={44} />
            <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
              {platform.label}
            </ThemedText>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Space.md,
    alignSelf: 'stretch',
  },
  flex: {
    flex: 1,
  },
  list: {
    gap: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  removeHit: {
    width: HitTarget - 10,
    height: HitTarget - 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCard: {
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  addHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingLeft: Space.md,
    paddingRight: Space.xs,
    height: HitTarget + 6,
    borderRadius: Radius.md,
  },
  at: {
    fontSize: Type.body.fontSize,
  },
  input: {
    flex: 1,
    fontSize: Type.body.fontSize,
    paddingVertical: 0,
  },
  save: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.lg,
  },
  pickerItem: {
    width: 60,
    alignItems: 'center',
    gap: Space.xs,
  },
});
