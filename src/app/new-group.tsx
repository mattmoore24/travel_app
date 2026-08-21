import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Segmented } from '@/components/ui/segmented';
import { Radius, Space } from '@/constants/theme';
import { uploadGroupPhoto } from '@/features/groups/api';
import { useCreateGroup } from '@/features/groups/hooks';
import { useOwnUserId } from '@/features/profile/hooks';
import { addDays, formatDate, toISODate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { pickImage } from '@/lib/pick-image';
import type { GroupSpeaking } from '@/lib/database.types';

const NAME_MAX = 60;

const SPEAKING_OPTIONS: { value: GroupSpeaking; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'granted', label: 'Only who I pick' },
];

/**
 * Start a group. Four decisions, in the order they matter: what it is called,
 * who may talk, how long anyone may stay, and a photo if you have one.
 *
 * The stay-until maximum is the part people skip past, so it says out loud
 * what it does: it caps what a joiner may choose for themselves, and their
 * membership ends on its own afterwards. Nothing here runs forever.
 */
export default function NewGroupScreen() {
  const theme = useTheme();
  const ownUserId = useOwnUserId();
  const createGroup = useCreateGroup();
  const [name, setName] = useState('');
  const [speaking, setSpeaking] = useState<GroupSpeaking>('everyone');
  const [maxStay, setMaxStay] = useState(() => addDays(new Date(), 30));
  const [pickingDate, setPickingDate] = useState(Platform.OS === 'ios');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();
  const ready = trimmed.length >= 2 && !busy && !createGroup.isPending;

  const submit = async () => {
    if (!ready || !ownUserId) {
      return;
    }
    setBusy(true);
    try {
      let photoPath: string | null = null;
      if (photoUri) {
        try {
          photoPath = await uploadGroupPhoto(ownUserId, photoUri);
        } catch {
          // A photo that will not upload is not a reason to lose the group.
          Alert.alert('Photo did not upload', 'Starting the group without it.');
        }
      }
      const chatId = await createGroup.mutateAsync({
        name: trimmed,
        maxStayUntil: toISODate(maxStay),
        speaking,
        photoPath,
      });
      router.replace(`/room/${chatId}`);
    } catch {
      // Surfaced by the global mutation error alert.
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScreen
      title="Start a group"
      subtitle="For the people you have actually met, or the ones you are about to."
      continueLabel="Create group"
      continueDisabled={!ready}
      continueLoading={busy || createGroup.isPending}
      onContinue={submit}>
      <View style={styles.photoRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={photoUri ? 'Change group photo' : 'Add a group photo'}
          haptic="light"
          scaleTo={0.94}
          onPress={async () => {
            const uri = await pickImage();
            if (uri) {
              setPhotoUri(uri);
            }
          }}
          style={[styles.photo, { backgroundColor: theme.surfaceSunken }]}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.fill} contentFit="cover" />
          ) : (
            <SymbolView
              name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
              size={20}
              tintColor={theme.textSecondary}
            />
          )}
        </PressableScale>
        <View style={styles.photoText}>
          <ThemedText type="smallBold">Group photo</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Optional. It shows up in everyone&apos;s chat list.
          </ThemedText>
          {photoUri ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove group photo"
              hitSlop={8}
              onPress={() => setPhotoUri(null)}>
              <ThemedText type="footnote" themeColor="accent">
                Remove
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </View>

      <FormTextField
        label="Name"
        testID="group-name-input"
        placeholder="Hostel crew, Sunday hike, Lisbon dinner"
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX}
        returnKeyType="done"
      />

      <View style={styles.block}>
        <ThemedText type="smallBold">Who can post</ThemedText>
        <Segmented
          options={SPEAKING_OPTIONS}
          value={speaking}
          onChange={setSpeaking}
          accessibilityLabel="Who can post in this group"
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          {speaking === 'everyone'
            ? 'Anyone in the group can post.'
            : 'You post, plus anyone you give the microphone to. Everyone else can read.'}
        </ThemedText>
      </View>

      <View style={styles.block}>
        <ThemedText type="smallBold">People can stay until</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          The furthest out anyone can pick when they join. They choose their own date up to this,
          and drop out on their own afterwards.
        </ThemedText>
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            value={maxStay}
            mode="date"
            display="compact"
            minimumDate={new Date()}
            themeVariant="dark"
            onChange={(_, date) => {
              if (date) {
                setMaxStay(date);
              }
            }}
          />
        ) : (
          <>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Change the latest stay-until date"
              haptic="selection"
              scaleTo={0.98}
              onPress={() => setPickingDate(true)}
              style={[styles.dateButton, { backgroundColor: theme.surfaceSunken }]}>
              <ThemedText>{formatDate(toISODate(maxStay))}</ThemedText>
            </PressableScale>
            {pickingDate ? (
              <DateTimePicker
                value={maxStay}
                mode="date"
                minimumDate={new Date()}
                onChange={(_, date) => {
                  setPickingDate(false);
                  if (date) {
                    setMaxStay(date);
                  }
                }}
              />
            ) : null}
          </>
        )}
      </View>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoText: {
    flex: 1,
    gap: 2,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  block: {
    gap: Space.sm,
  },
  dateButton: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
});
