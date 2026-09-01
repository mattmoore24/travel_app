import { router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadError } from '@/components/ui/load-error';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Space } from '@/constants/theme';
import { useBlocks, useUnblockUser } from '@/features/chat/hooks';
import { useTheme } from '@/hooks/use-theme';

/**
 * Everyone this account has blocked, and the way to undo one.
 *
 * Blocking was a one-way door with no inventory: it cuts visibility in both
 * directions, so somebody who blocked the wrong person from a crowded group
 * thread could not undo it and could not even see who they had blocked - which
 * is also the support case the founder cannot fix from the app, "my friend has
 * disappeared and I do not know why". A safety feature people are afraid to
 * use pushes travelers toward the weaker option of not replying at all.
 *
 * No migration was needed for any of it. blocks_select_own, blocks_insert_own
 * and blocks_delete_own have been on the table since 20260816200000, and only
 * update and truncate were ever revoked.
 */
function BlockedRow({
  name,
  onUnblock,
  first,
}: {
  name: string;
  onUnblock: () => void;
  first: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline },
      ]}>
      <ThemedText style={styles.flex} numberOfLines={1}>
        {name}
      </ThemedText>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Unblock ${name}`}
        haptic="light"
        scaleTo={0.94}
        hitSlop={10}
        onPress={onUnblock}
        style={[styles.action, { backgroundColor: theme.surfaceSunken }]}>
        <ThemedText type="footnote" themeColor="accent">
          Unblock
        </ThemedText>
      </PressableScale>
    </View>
  );
}

export default function BlockedScreen() {
  const theme = useTheme();
  // The whole query, not its rows: destructuring the data away is what once
  // told somebody with six archived conversations, offline, that they had
  // none. An inventory of blocks is the same shape of wrong answer.
  const query = useBlocks();
  const blocks = query.data ?? [];
  const unblock = useUnblockUser();

  const confirm = (userId: string, name: string) => {
    Alert.alert(`Unblock ${name}?`, 'They will be able to see you again, and you them.', [
      { text: 'Keep blocked', style: 'cancel' },
      { text: 'Unblock', onPress: () => unblock.mutate(userId) },
    ]);
  };

  return (
    <StepScreen
      title="Blocked"
      // What unblocking does NOT do, said before it is tapped. The block
      // closed the chat and that stays closed, and any report stays filed:
      // both are deliberate, and somebody should know before they wonder why
      // the conversation did not come back.
      subtitle="Nobody here can see you, and you cannot see them. Unblocking changes that. It does not reopen a chat that was closed, and it does not withdraw a report."
      continueLabel="Done"
      onContinue={() => (router.canGoBack() ? router.back() : router.replace('/profile-me'))}>
      {query.isPending ? (
        <>
          <Skeleton height={56} radius={Radius.md} />
          <Skeleton height={56} radius={Radius.md} />
        </>
      ) : null}
      {query.isError ? (
        <LoadError compact what="your blocked list" error={query.error} onRetry={query.refetch} />
      ) : null}
      {blocks.length > 0 ? (
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          {blocks.map((block, index) => (
            <BlockedRow
              key={block.userId}
              // A blocked account whose profile row is gone still has to
              // appear: a list that quietly drops rows is not an inventory.
              name={block.name ?? 'Someone who has left'}
              first={index === 0}
              onUnblock={() => confirm(block.userId, block.name ?? 'them')}
            />
          ))}
        </View>
      ) : null}
      {/* Only on success-with-zero: a failed fetch is not an empty list. */}
      {query.isSuccess && blocks.length === 0 ? (
        <EmptyState
          title="Nobody blocked"
          body="Block somebody from their profile or a chat and they land here, where you can undo it."
        />
      ) : null}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  card: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 56,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  action: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
  },
});
