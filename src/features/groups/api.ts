import { CHAT_PHOTO_BUCKET } from '@/features/chat/api';
import { processAndUploadImage } from '@/lib/image-upload';
import { supabase } from '@/lib/supabase';
import type {
  GroupInvitePreviewRow,
  GroupInvitesWho,
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
  /** Who may hand out the invite link. Omitted leaves it alone. */
  invites?: GroupInvitesWho;
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
    p_invites: input.invites ?? null,
    p_max_stay_until: input.maxStayUntil ?? null,
    p_photo_path: input.photoPath ?? null,
    p_clear_photo: input.clearPhoto ?? false,
    p_clear_max_stay: input.clearMaxStay ?? false,
  });
  if (error) {
    throw error;
  }
}

/**
 * Group photos share the chat-photo BUCKET, and since 20260903050000 they
 * are checked too - by their own trigger, not the bucket's.
 *
 * Moderation attaches to the ROW a photo creates, never to the bucket it is
 * stored in. A chat photo is moderated through its `messages` row; a group's
 * own picture is `groups.photo_path`, which for two weeks was a plain column
 * with no trigger, so it reached every member and every invite holder
 * unchecked. app.json's camera string had promised Apple that every photo is
 * checked first; it was narrowed to profile and chat photos on 2026-09-01
 * (cc82431) because this gap made the wider claim untrue. Now:
 * `groups.photo_status` is set pending by a trigger on every change of the
 * path (with require_photo_moderation on, which is how production runs), the
 * moderation worker's group-photo queue hands down the verdict against the
 * path it classified, and the three RPCs (`my_chats`, `group_invite_preview`,
 * `group_detail`) and the storage policy mask an unapproved picture from
 * everyone but the person who uploaded it.
 *
 * 20260903130000 finished that: the STATUS was masked by nothing but the
 * client until then, so a member could read `photo_status` off the table and
 * watch 'pending' become 'rejected'. `groups` is column-granted now and the
 * three photo columns are not granted at all. features/groups/photo.ts is
 * still the one client reading of the two columns together — useGroup hands
 * screens the view, never the raw columns — but it is UX on top of the
 * server's answer now, not the thing deciding it.
 *
 * The path has to be under this user's own folder: the trigger refuses any
 * other prefix, because the prefix is how the server knows who set it.
 */
export async function uploadGroupPhoto(userId: string, localUri: string): Promise<string> {
  return processAndUploadImage(CHAT_PHOTO_BUCKET, userId, localUri);
}

/**
 * The group row, as the server is willing to hand it to this reader.
 *
 * `select('*')` off the table until 20260903130000, which is what made the
 * masking in photo.ts the only thing standing between a member and the
 * verdict on somebody else's photo: `grant select on public.groups` was
 * table-level, so `select photo_status from groups where name = '...'` answered
 * 'pending' and then 'rejected' to anybody in the room with an anon key.
 * `groups` now grants its columns one by one, the three photo columns are not
 * among them, and this RPC is the only way in: it masks them the way my_chats
 * already masks the path, and it is members-only in its own right because a
 * definer function does not get RLS.
 */
export async function fetchGroup(chatId: string): Promise<GroupRow | null> {
  const { data, error } = await supabase.rpc('group_detail', { p_chat_id: chatId });
  if (error == null) {
    const rows = (data ?? []) as GroupRow[];
    return rows[0] ?? null;
  }
  // THE DEPLOY WINDOW, and this one runs the other way round.
  //
  // The house rule is migrations first, then the update, because a new bundle
  // usually reads a new column. 20260903130000 is the opposite: it REVOKES
  // the table grant that the bundle already on the phone selects through. Run
  // it first and every installed build's group page answers "permission
  // denied" until the update lands - and an expo-updates bundle is never
  // applied on the launch that downloads it, so that is at least one launch
  // of a broken screen on a build the founder is about to install.
  //
  // So this ships FIRST and reads both schemas: the RPC when it exists, the
  // table when it does not. PGRST202 is PostgREST for "no such function",
  // which is exactly and only the pre-migration project. Any other error is
  // still an error.
  if (error.code !== 'PGRST202') {
    throw error;
  }
  const { data: row, error: tableError } = await supabase
    .from('groups')
    .select(
      'chat_id, created_by, name, photo_path, photo_status, speaking, invites, max_stay_until, pin_id, plan_ended_at, created_at'
    )
    .eq('chat_id', chatId)
    .maybeSingle();
  if (tableError) {
    throw tableError;
  }
  return (row as GroupRow | null) ?? null;
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
