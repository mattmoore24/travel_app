import { after, between, source } from '@/lib/__tests__/source';

/**
 * Skeleton before words, on the screens a render test cannot stand up.
 *
 * The one-to-one thread, the room, the group page, the chat tab and the
 * owner's profile each mount a keyboard floor, a composer, a swipeable list
 * or a dozen queries, which is more mocking than a test about one branch
 * should carry. What is pinned here is the branch itself: the pending
 * state draws a shape, the error state offers a retry, and the empty words
 * are gated on success. The shapes themselves are tested where they live
 * (components/ui/__tests__/skeleton-shapes).
 */

describe('the one-to-one thread', () => {
  const code = source('src/app/chat/[id].tsx');

  it('draws a thread shape before the row is known, a cold deep link included', () => {
    // The `!chat` branch used to be the header over nothing while the chat
    // list was pending: the push-notification destination, blank.
    const noRow = between(code, 'if (!chat) {', 'const closed = chat.chat_status');
    expect(noRow).toContain('<ThreadSkeleton />');
    // Either list can fail, and the row is looked up in both: a push for an
    // archived conversation whose list failed drew the skeleton for ever.
    expect(noRow).toContain('chatsQuery.isError || archivedQuery.isError ? (');
    expect(noRow).toContain('settled(chatsQuery) && settled(archivedQuery) ? (');
    expect(noRow).toContain('Chat not found.');
  });

  it('draws the inverted thread shape while the first page is on its way', () => {
    // MessageThread's list is inverted, so the skeleton has to undo the
    // mirror itself; ThreadSkeleton does, under `inverted`.
    expect(code).toContain(
      'emptyState={messagesQuery.isPending ? <ThreadSkeleton inverted /> : null}'
    );
  });
});

describe('the room', () => {
  it('replaces its pending null with the inverted thread shape', () => {
    const code = source('src/app/room/[id].tsx');
    const empty = between(code, 'emptyState={', 'Your group is ready.');
    expect(empty).toContain('messagesQuery.isPending ? (');
    expect(empty).toContain('<ThreadSkeleton inverted />');
    expect(empty).not.toContain('messagesQuery.isPending ? null');
  });

  it('draws its failed state inside the flipped container, like every other empty state', () => {
    // The inverted list mirrors its empty component and offers the
    // counter-flip as a `style` prop LoadError does not take (traps:
    // Lists), so a bare LoadError read upside down at the composer.
    const code = source('src/app/room/[id].tsx');
    const failed = between(code, 'messagesQuery.isError ? (', 'messagesQuery.isPending ? (');
    expect(failed).toContain('<View style={styles.emptyThread}>');
    expect(failed).toContain('<LoadError');
  });
});

describe('the group page', () => {
  it('draws the settings shape while the group is on its way', () => {
    const code = source('src/app/group/[id].tsx');
    const noGroup = between(code, 'if (!group) {', 'const uri = await pickImage();');
    expect(noGroup).toContain('groupQuery.isError ? (');
    expect(noGroup).toContain('This group is no longer around.');
    expect(noGroup).toContain('<Skeleton width={84} height={84} radius={Radius.lg} />');
    expect(noGroup.match(/<RowSkeleton \/>/g)).toHaveLength(3);
  });
});

describe('the owner profile', () => {
  const code = source('src/app/profile-me.tsx');

  it('draws the hero shape while the profile is pending and a retry when it fails', () => {
    // The same skeleton profile/[userId] draws, so the two pages look the
    // same while they wait: they render the same component once it lands.
    const noProfile = between(code, 'if (!profile) {', 'const stackPreview =');
    expect(noProfile).toContain('<ProfileHeroSkeleton />');
    expect(noProfile).toContain('what="your profile"');
    expect(noProfile).toContain('profileQuery.refetch()');
  });

  it('hands ProfileView the pending flags so it draws shapes, not invitations', () => {
    // "Add a trip and you'll see who else is there" over trips that are a
    // round trip away is the lie these hold back, and the same for the list
    // and the prompts.
    // Both mounts: the owner's page and the stranger's-copy preview. The
    // first `<ProfileView` in the file is the preview, so the owner mount is
    // cut by the prop only it carries.
    expect(code.match(/tripsPending=\{tripsQuery\.data === undefined\}/g)).toHaveLength(2);
    const owner = between(code, 'photoChecking={checkingHero != null}', 'profile={profile}');
    expect(owner).toContain('tripsPending={tripsQuery.data === undefined}');
    expect(owner).toContain('prioritiesPending={prioritiesQuery.data === undefined}');
    expect(owner).toContain('promptsPending={promptsQuery.data === undefined}');
  });
});

describe('the chat tab', () => {
  const code = source('src/app/(tabs)/chat.tsx');

  it('draws the rooms section as a shape while the rooms load', () => {
    const discovery = between(code, 'function RoomDiscovery(', 'function ChatRowLink(');
    expect(discovery).toContain('if (pending && rooms.length === 0) {');
    expect(discovery.match(/<RowSkeleton \/>/g)).toHaveLength(2);
    // Loading or paused, never merely disabled: with no browsing city the
    // query is idle and pending forever.
    expect(code).toContain(
      "const roomsPending = roomsQuery.isPending && roomsQuery.fetchStatus !== 'idle';"
    );
    expect(code.match(/pending=\{roomsPending\}/g)).toHaveLength(2);
  });

  it('spins the pull-to-refresh only for a pull', () => {
    // isFetching is true for the focus refetch and every background fetch,
    // so the list dipped and spun on every return to the tab.
    const list = after(code, '<SectionList');
    expect(list).toContain('refreshing={pull.refreshing}');
    expect(list).toContain('onRefresh={pull.onRefresh}');
    expect(list).not.toContain('chatsQuery.isFetching');
    expect(code).toContain('const pull = usePullRefresh(');
  });
});
