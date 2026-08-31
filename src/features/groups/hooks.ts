import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
import { useOwnUserId } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { GroupInvitesWho, GroupSpeaking } from '@/lib/database.types';

export function useGroup(chatId: string | null) {
  return useQuery({
    queryKey: ['group', chatId],
    queryFn: () => fetchGroup(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
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
