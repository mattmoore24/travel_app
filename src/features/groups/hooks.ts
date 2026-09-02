import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  addToGroup,
  createGroup,
  fetchGroup,
  fetchGroupMembers,
  groupInvitePreview,
  groupInviteToken,
  joinGroupWithInvite,
  openDirectChat,
  peopleYouKnow,
  removeGroupMember,
  revokeGroupInvites,
  setGroupRole,
  sharesGroupWith,
  updateGroup,
} from '@/features/groups/api';
import { groupView } from '@/features/groups/photo';
import { useOwnUserId } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { GroupInvitesWho, GroupRow, GroupSpeaking } from '@/lib/database.types';

export function useGroup(chatId: string | null) {
  const ownUserId = useOwnUserId();
  // The row leaves this feature as a GroupView and nothing else: the two raw
  // photo columns are replaced by the one client reading of them
  // (features/groups/photo.ts), so no screen can draw a picture the server
  // has not cleared, however it spells the column. `select` runs on the
  // observer, which is why the cache and the poll below still hold the raw
  // row.
  //
  // Since 20260903130000 the raw row IS the masked row: fetchGroup reads
  // group_detail, which hands a member null for both photo columns while
  // somebody else's photo is being checked. So this is UX on top of the
  // server's answer, not the thing deciding it.
  const select = useCallback((row: GroupRow | null) => groupView(row, ownUserId), [ownUserId]);
  return useQuery({
    queryKey: ['group', chatId],
    queryFn: () => fetchGroup(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
    select,
    // A photo's verdict lands in the database, not in this app, and the
    // group page is the screen most likely to be open while it does: the
    // admin has just picked a picture and is looking at "Checking this
    // photo". Without a watch it says that until they leave and come back,
    // and a refused photo never gets to say "pick another". A poll rather
    // than a subscription, for the reasons useBusinessPhotos gives: no
    // channel, no policy, and it stops on its own the moment the row has
    // nothing pending.
    //
    // Only the SETTER polls, and that is the rule rather than an oversight:
    // the row is masked server-side now, so a member is handed no pending
    // status to poll on - and a member whose app polled every five seconds
    // BECAUSE a photo was pending would be a phone that knows the fact the
    // server declined to tell it. Their page picks the picture up on the
    // next refetch once it clears, the same way it picks up a name change.
    refetchInterval: (query) =>
      query.state.data?.photo_status === 'pending' && query.state.data.photo_path != null
        ? 5_000
        : false,
  });
}

export function useGroupMembers(chatId: string | null) {
  return useQuery({
    queryKey: ['group-members', chatId],
    queryFn: () => fetchGroupMembers(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
  });
}

export function useCreateGroup() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      analytics.capture('group_created');
      queryClient.invalidateQueries({ queryKey: ['chats', userId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useUpdateGroup(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name?: string;
      speaking?: GroupSpeaking;
      invites?: GroupInvitesWho;
      maxStayUntil?: string;
      clearMaxStay?: boolean;
      photoPath?: string | null;
      clearPhoto?: boolean;
    }) => updateGroup({ chatId, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useSetGroupRole(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role: 'member' | 'speaker' }) =>
      setGroupRole({ chatId, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-members', chatId] });
    },
  });
}

export function useRemoveGroupMember(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeGroupMember(chatId, userId),
    onSuccess: () => {
      analytics.capture('group_member_removed');
      queryClient.invalidateQueries({ queryKey: ['group-members', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

/**
 * The group's live invite link. Minted on demand and cached, so opening the
 * share sheet twice gives the same link rather than quietly cutting off
 * whoever already has one.
 */
export function useGroupInviteToken(chatId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['group-invite', chatId],
    queryFn: () => groupInviteToken(chatId!),
    enabled: isSupabaseConfigured && chatId != null && enabled,
    staleTime: 10 * 60 * 1000,
  });
}

export function useRevokeGroupInvites(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revokeGroupInvites(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-invite', chatId] });
    },
  });
}

export function useGroupInvitePreview(token: string | null) {
  return useQuery({
    queryKey: ['group-invite-preview', token],
    queryFn: () => groupInvitePreview(token!),
    enabled: isSupabaseConfigured && token != null && token.length > 0,
    // Retries like every other query (query-client sets 2). It used to be
    // `false`, so one flaky moment on a phone that had just been handed a
    // link told somebody their friend's invite was dead.
  });
}

export function useJoinGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: joinGroupWithInvite,
    onSuccess: () => {
      analytics.capture('group_joined');
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

/**
 * The address book, searched as you type.
 *
 * `keepPreviousData` on purpose: the list is short and the query fires per
 * keystroke, so without it every letter empties the sheet and the row you
 * were reaching for jumps out from under your thumb.
 */
export function usePeopleYouKnow(query: string) {
  return useQuery({
    queryKey: ['people-you-know', query.trim()],
    queryFn: () => peopleYouKnow(query),
    enabled: isSupabaseConfigured,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useAddToGroup(chatId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => addToGroup(chatId!, userId),
    onSuccess: () => {
      analytics.capture('group_member_added');
      queryClient.invalidateQueries({ queryKey: ['group-members', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

/** Whether the say-hi gate applies to this person, or you already know them. */
export function useSharesGroupWith(userId: string | null) {
  return useQuery({
    queryKey: ['shares-group', userId],
    queryFn: () => sharesGroupWith(userId!),
    enabled: isSupabaseConfigured && userId != null,
    staleTime: 60_000,
  });
}

export function useOpenDirectChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, firstMessage }: { userId: string; firstMessage: string }) =>
      openDirectChat(userId, firstMessage),
    onSuccess: (result) => {
      if (result.blocked) {
        return;
      }
      analytics.capture('direct_chat_opened');
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}
