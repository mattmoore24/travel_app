import { CHAT_PHOTO_BUCKET } from '@/features/chat/api';
import { processAndUploadImage } from '@/lib/image-upload';
import { supabase } from '@/lib/supabase';
import type {
  GroupInvitePreviewRow,
  GroupMemberRow,
  GroupRow,
  GroupSpeaking,
  KnownPersonRow,
} from '@/lib/database.types';

/**
 * Groups travelers make themselves. Everything that decides anything — who
 * may change the group, who may speak in it, how long a joiner may stay —
 * lives in the database (see the traveler_groups migration). These are the
 * doors, not the locks.
 */

export async function createGroup(input: {
  name: string;
  /** Null for "no end date": the chat never closes. */
  maxStayUntil: string | null;
  speaking: GroupSpeaking;
  photoPath: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_group', {
    p_name: input.name,
    p_max_stay_until: input.maxStayUntil,
    p_speaking: input.speaking,
    p_photo_path: input.photoPath,
  });
  if (error) {
    throw error;
  }
  return data as string;
}

export async function updateGroup(input: {
  chatId: string;
  name?: string;
  speaking?: GroupSpeaking;
  maxStayUntil?: string;
  photoPath?: string | null;
  clearPhoto?: boolean;
  /**
   * Turn the end date off. Its own flag because an omitted maxStayUntil has
   * always meant "leave it alone" in this call, exactly like clearPhoto.
   */
  clearMaxStay?: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('update_group', {
    p_chat_id: input.chatId,
    p_name: input.name ?? null,
    p_speaking: input.speaking ?? null,
    p_max_stay_until: input.maxStayUntil ?? null,
    p_photo_path: input.photoPath ?? null,
    p_clear_photo: input.clearPhoto ?? false,
    p_clear_max_stay: input.clearMaxStay ?? false,
  });
  if (error) {
    throw error;
  }
}

/** Group photos share the chat-photo bucket, and its moderation with it. */
export async function uploadGroupPhoto(userId: string, localUri: string): Promise<string> {
  return processAndUploadImage(CHAT_PHOTO_BUCKET, userId, localUri);
}

export async function fetchGroup(chatId: string): Promise<GroupRow | null> {
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as GroupRow | null) ?? null;
}

export async function fetchGroupMembers(chatId: string): Promise<GroupMemberRow[]> {
  const { data, error } = await supabase.rpc('group_members', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
  return (data ?? []) as GroupMemberRow[];
}

export async function setGroupRole(input: {
  chatId: string;
  userId: string;
  role: 'member' | 'speaker';
}): Promise<void> {
  const { error } = await supabase.rpc('set_group_role', {
    p_chat_id: input.chatId,
    p_user_id: input.userId,
    p_role: input.role,
  });
  if (error) {
    throw error;
  }
}

/** Removing somebody reuses the room path, which the admin now satisfies. */
export async function removeGroupMember(chatId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('room_remove_member', {
    p_chat_id: chatId,
    p_user_id: userId,
  });
  if (error) {
    throw error;
  }
}

export async function groupInviteToken(chatId: string): Promise<string> {
  const { data, error } = await supabase.rpc('group_invite_token', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
  return data as string;
}

export async function revokeGroupInvites(chatId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_group_invites', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
}

export async function groupInvitePreview(token: string): Promise<GroupInvitePreviewRow | null> {
  const { data, error } = await supabase.rpc('group_invite_preview', { p_token: token });
  if (error) {
    throw error;
  }
  const rows = (data ?? []) as GroupInvitePreviewRow[];
  return rows[0] ?? null;
}

export async function joinGroupWithInvite(input: {
  token: string;
  stayUntil: string;
}): Promise<{ chat_id: string; stay_until: string; expires_at: string }> {
  const { data, error } = await supabase.rpc('join_group_with_invite', {
    p_token: input.token,
    p_stay_until: input.stayUntil,
  });
  if (error) {
    throw error;
  }
  return data as { chat_id: string; stay_until: string; expires_at: string };
}

/**
 * Everybody you have actually met in here: a one-to-one chat, or a group you
 * are both in. The server decides what counts — a venue room does not, and
 * neither does a guest — so this is a door, not a lock.
 */
export async function peopleYouKnow(query: string): Promise<KnownPersonRow[]> {
  const { data, error } = await supabase.rpc('people_you_know', {
    p_query: query.trim() || null,
  });
  if (error) {
    throw error;
  }
  return (data ?? []) as KnownPersonRow[];
}

/** Any member may bring somebody. Removing them is still the admin's. */
export async function addToGroup(chatId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('add_to_group', {
    p_chat_id: chatId,
    p_user_id: userId,
  });
  if (error) {
    throw error;
  }
}

export async function sharesGroupWith(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('shares_group_with', { p_user_id: userId });
  if (error) {
    throw error;
  }
  return data === true;
}

/**
 * Start talking to somebody you are already in a group with. No request, no
 * accept: the first message is screened at the door instead, and a blocked
 * one opens nothing at all.
 */
export async function openDirectChat(
  userId: string,
  firstMessage: string
): Promise<{ chatId: string | null; blocked: boolean }> {
  const { data, error } = await supabase.rpc('open_direct_chat', {
    p_user_id: userId,
    p_first_message: firstMessage,
  });
  if (error) {
    throw error;
  }
  const result = data as { chat_id?: string; blocked: boolean };
  return { chatId: result.chat_id ?? null, blocked: result.blocked };
}
