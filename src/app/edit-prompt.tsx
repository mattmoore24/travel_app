import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import {
  useDeleteProfilePrompt,
  useOwnUserId,
  useProfilePrompts,
  useSaveProfilePrompt,
} from '@/features/profile/hooks';
import {
  PROMPT_ANSWER_MAX,
  nextFreeSlot,
  promptLabel,
  promptPlaceholder,
  unusedPrompts,
} from '@/features/profile/prompts';
import { haptics } from '@/lib/haptics';

/**
 * Answer one prompt.
 *
 * Two ways in: tapping an answered one (slot supplied, question fixed, the
 * answer is what changes) or the nudge on an empty profile (no slot, so the
 * question is picked first).
 */
export default function EditPromptScreen() {
  const params = useLocalSearchParams<{ slot?: string }>();
  const userId = useOwnUserId();
  const { data: prompts = [] } = useProfilePrompts(userId);
  const save = useSaveProfilePrompt();
  const remove = useDeleteProfilePrompt();

  const editingSlot = params.slot != null ? Number(params.slot) : null;
  const existing = prompts.find((p) => p.slot === editingSlot) ?? null;
  const slot = existing?.slot ?? nextFreeSlot(prompts.map((p) => p.slot));

  // The questions still on offer: everything unanswered, plus the one being
  // edited (which would otherwise vanish from its own screen).
  const options = useMemo(() => {
    const taken = prompts.filter((p) => p.slot !== editingSlot).map((p) => p.prompt_key);
    return unusedPrompts(taken).map((prompt) => ({ value: prompt.key, label: prompt.label }));
  }, [prompts, editingSlot]);

  const [promptKey, setPromptKey] = useState(existing?.prompt_key ?? options[0]?.value ?? '');
  const [answer, setAnswer] = useState(existing?.answer ?? '');

  const trimmed = answer.trim();
  const canSave = slot != null && promptKey.length > 0 && trimmed.length > 0;

  const submit = async () => {
    if (!canSave || slot == null) {
      return;
    }
    try {
      await save.mutateAsync({ slot, promptKey, answer: trimmed });
      haptics.success();
      router.back();
    } catch (error) {
      // The one failure worth naming: the same filter the bio goes through.
      const raw = (error as { message?: unknown })?.message;
      Alert.alert(
        'Could not save that',
        typeof raw === 'string' && /community guidelines/i.test(raw)
          ? 'That answer breaks our community guidelines. Reword it and try again.'
          : 'Check your connection and try again.'
      );
    }
  };

  if (slot == null) {
    return (
      <StepScreen
        title="Your prompts are full"
        subtitle="Three is the limit. Edit one you already have."
        continueLabel="Back"
        onContinue={() => router.back()}>
        <View />
      </StepScreen>
    );
  }

  return (
    <StepScreen
      title={existing ? promptLabel(existing.prompt_key) : 'Answer a prompt'}
      subtitle={
        existing
          ? 'Change your answer, or pick a different question.'
          : 'Pick a question people can actually reply to.'
      }
      continueLabel="Save"
      continueDisabled={!canSave}
      continueLoading={save.isPending}
      onContinue={submit}
      footer={
        existing ? (
          <PrimaryButton
            variant="ghost"
            label="Remove this prompt"
            onPress={() =>
              Alert.alert('Remove this prompt?', 'The answer goes with it.', [
                { text: 'Keep it', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: async () => {
                    await remove.mutateAsync(existing.slot).catch(() => {});
                    router.back();
                  },
                },
              ])
            }
          />
        ) : null
      }>
      <ThemedText type="smallBold">Question</ThemedText>
      <ChipRow
        options={options}
        selected={[promptKey]}
        onToggle={(value) => {
          setPromptKey(value);
          // The placeholder changes with the question, so an answer typed
          // against the old one would read as an answer to the new one.
          if (existing == null) {
            setAnswer('');
          }
        }}
      />
      <View style={styles.answerBlock}>
        <FormTextField
          label="Your answer"
          multiline
          numberOfLines={3}
          autoFocus={existing != null}
          maxLength={PROMPT_ANSWER_MAX}
          style={styles.answer}
          placeholder={promptPlaceholder(promptKey)}
          value={answer}
          onChangeText={setAnswer}
          hint={`${answer.length}/${PROMPT_ANSWER_MAX}`}
        />
      </View>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  answerBlock: {
    paddingTop: Space.sm,
  },
  answer: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
});
