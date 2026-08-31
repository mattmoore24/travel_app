import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { GroupAddPolicy } from '@/lib/database.types';

/**
 * Who may put you in a group, and who put you in this one.
 *
 * Both questions go through definer functions bound to auth.uid(), the same
 * way visibility does: `profiles.group_adds` is not a column any client may
 * read, on themselves or on anybody else, and room_members.added_by is only
 * ever answered for the reader's own membership.
 */

export const GROUP_ADD_OPTIONS: { value: GroupAddPolicy; label: string; detail: string }[] = [
  {
    value: 'known',
    label: 'Anyone you have chatted with',
    detail: 'They can add you straight into a group with people you have not met.',
  },
  {
    value: 'link_only',
    label: 'Only by invite link',
    detail: 'Nobody can add you. You join groups by opening a link, which is always your choice.',
  },
];

export async function fetchGroupAdds(): Promise<GroupAddPolicy> {
  const { data, error } = await supabase.rpc('my_group_adds');
  if (error) {
    throw error;
  }
  return (data as GroupAddPolicy | null) ?? 'known';
}

export async function setGroupAdds(policy: GroupAddPolicy): Promise<GroupAddPolicy> {
  const { data, error } = await supabase.rpc('set_group_adds', { p_policy: policy });
  if (error) {
    throw error;
  }
  return data as GroupAddPolicy;
}

/** The name of whoever added this reader to this chat, or null for nobody. */
export async function fetchWhoAddedMe(chatId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('who_added_me', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
  return (data as string | null) ?? null;
}

export function useGroupAdds() {
  return useQuery({
    queryKey: ['group-adds'],
    queryFn: fetchGroupAdds,
    enabled: isSupabaseConfigured,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSetGroupAdds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setGroupAdds,
    meta: { failureTitle: 'Could not save that' },
    // Optimistic, like the audience picker: the row is a choice, and a radio
    // that waits on a round trip before it moves reads as a dead control.
    onMutate: (policy: GroupAddPolicy) => {
      queryClient.setQueryData(['group-adds'], policy);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['group-adds'] });
    },
  });
}

/**
 * Who added the reader to this chat. Null for a room they joined themselves,
 * for one they opened a link to, and for every chat that predates the column.
 */
export function useWhoAddedMe(chatId: string | null) {
  return useQuery({
    queryKey: ['who-added-me', chatId],
    queryFn: () => fetchWhoAddedMe(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
    staleTime: 10 * 60 * 1000,
  });
}
