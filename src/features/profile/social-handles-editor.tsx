import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  useDeleteSocialHandle,
  useOwnSocialHandles,
  useUpsertSocialHandle,
} from '@/features/profile/hooks';
import { normalizeHandle, validateHandle } from '@/features/profile/validation';
import { useTheme } from '@/hooks/use-theme';
import type { SocialPlatform } from '@/lib/database.types';

const PLATFORM_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'snapchat', label: 'Snapchat' },
  { value: 'x', label: 'X' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
] as const;

const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  PLATFORM_OPTIONS.map((o) => [o.value, o.label])
);

/**
 * Manage own social handles. These are stored now but only ever revealed to
 * others through an accepted chat — enforced by RLS, not just UI.
 */
export function SocialHandlesEditor() {
  const theme = useTheme();
  const { data: handles = [] } = useOwnSocialHandles();
  const upsert = useUpsertSocialHandle();
  const remove = useDeleteSocialHandle();

  const [platform, setPlatform] = useState<SocialPlatform>('instagram');
  const [handle, setHandle] = useState('');
  const [touched, setTouched] = useState(false);

  const error = touched && handle !== '' ? validateHandle(handle) : null;

  const add = async () => {
    setTouched(true);
    if (validateHandle(handle) != null) {
      return;
    }
    await upsert.mutateAsync({ platform, handle: normalizeHandle(handle) });
    setHandle('');
    setTouched(false);
  };

  return (
    <View style={styles.container}>
      {handles.length > 0 ? (
        <View style={styles.list}>
          {handles.map((row) => (
            <ThemedView key={row.id} type="backgroundElement" style={styles.handleRow}>
              <ThemedText type="small">
                {PLATFORM_LABELS[row.platform] ?? row.platform} · @{row.handle}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${row.platform} handle`}
                hitSlop={8}
                onPress={() => remove.mutate(row.id)}>
                <SymbolView
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  size={12}
                  tintColor={theme.textSecondary}
                />
              </Pressable>
            </ThemedView>
          ))}
        </View>
      ) : null}

      <ChipRow
        options={PLATFORM_OPTIONS}
        selected={[platform]}
        onToggle={(value) => setPlatform(value)}
      />
      <FormTextField
        placeholder="@handle"
        autoCapitalize="none"
        autoCorrect={false}
        value={handle}
        onChangeText={setHandle}
        error={error}
      />
      <PrimaryButton
        variant="ghost"
        label="Add handle"
        disabled={handle.trim() === '' || upsert.isPending}
        onPress={add}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  list: {
    gap: Spacing.two,
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
});
