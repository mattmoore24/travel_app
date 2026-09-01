import {
  PROFILE_COLUMNS,
  VERIFICATION_REQUEST_COLUMNS,
  type ProfileAudience,
  type ProfilePriorityRow,
  type ProfilePromptRow,
  type ProfileUpdate,
  type SocialPlatform,
  type VerificationRequestRow,
} from '@/lib/database.types';
import { tightenSlots } from '@/features/profile/slots';
import { forgetAppleUser } from '@/lib/apple-user';
import { processAndUploadImage, removeUploadedImage } from '@/lib/image-upload';
import { forgetLastEmail } from '@/lib/last-email';
import { supabase } from '@/lib/supabase';

export const PHOTO_BUCKET = 'profile-photos';
export const VERIFICATION_BUCKET = 'verification-selfies';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// profiles has column-level SELECT grants (verification jsonb is server-only),
// so `select('*')` would be rejected — always name the readable columns.

/** Another user's profile; null when RLS hides them (hidden/banned/blocked). */
export async function fetchPublicProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

export async function fetchProfilePrompts(userId: string) {
  const { data, error } = await supabase
    .from('profile_prompts')
    .select('*')
    .eq('user_id', userId)
    .order('slot');
  if (error) {
    throw error;
  }
  return (data ?? []) as ProfilePromptRow[];
}

export async function saveProfilePrompt(input: {
  userId: string;
  slot: number;
  promptKey: string;
  answer: string;
}) {
  const { error } = await supabase.from('profile_prompts').upsert(
    {
      user_id: input.userId,
      slot: input.slot,
      prompt_key: input.promptKey,
      answer: input.answer,
    },
    { onConflict: 'user_id,slot' }
  );
  if (error) {
    throw error;
  }
}

export async function deleteProfilePrompt(userId: string, slot: number) {
  const { error } = await supabase
    .from('profile_prompts')
    .delete()
    .eq('user_id', userId)
    .eq('slot', slot);
  if (error) {
    throw error;
  }
}

/**
 * The Top priorities list. Same query for your own and somebody else's, like
 * prompts: RLS decides what comes back, and the profile renders both the same
 * way so you always see yours as a stranger does.
 */
export async function fetchProfilePriorities(userId: string) {
  const { data, error } = await supabase
    .from('profile_priorities')
    .select('*')
    .eq('user_id', userId)
    .order('slot');
  if (error) {
    throw error;
  }
  return (data ?? []) as ProfilePriorityRow[];
}

export async function saveProfilePriority(input: { userId: string; slot: number; text: string }) {
  const { error } = await supabase
    .from('profile_priorities')
    .upsert(
      { user_id: input.userId, slot: input.slot, text: input.text },
      { onConflict: 'user_id,slot' }
    );
  if (error) {
    throw error;
  }
}

export async function deleteProfilePriority(userId: string, slot: number) {
  const { error } = await supabase
    .from('profile_priorities')
    .delete()
    .eq('user_id', userId)
    .eq('slot', slot);
  if (error) {
    throw error;
  }
}

/**
 * Remove one entry and pull the rest up, so the list is always `0..n-1` and
 * nothing downstream has to reason about a gap.
 *
 * The arithmetic lives in `tightenSlots` because the ordering rules there are
 * the whole correctness of this, and they are much easier to get wrong than
 * to test. This function is only the round trips.
 */
export async function removeProfilePriority(
  userId: string,
  slot: number,
  rows: { slot: number; text: string }[]
) {
  const { writes, deletes } = tightenSlots(
    rows.filter((row) => row.slot !== slot),
    rows.map((row) => row.slot)
  );
  for (const write of writes) {
    await saveProfilePriority({ userId, slot: write.slot, text: write.row.text });
  }
  for (const stale of deletes) {
    await deleteProfilePriority(userId, stale);
  }
}

export async function fetchOwnProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .single();
  if (error) {
    throw error;
  }
  return data;
}

export async function updateOwnProfile(userId: string, patch: ProfileUpdate) {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('user_id', userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) {
    throw error;
  }
  return data;
}

export async function fetchPhotos(userId: string) {
  const { data, error } = await supabase
    .from('profile_photos')
    .select('*')
    .eq('user_id', userId)
    .order('position')
    .order('created_at');
  if (error) {
    throw error;
  }
  return data;
}

/**
 * Upload a photo, then register it in profile_photos (which runs the
 * server-side moderation chokepoint).
 */
export async function uploadPhoto(userId: string, localUri: string, position: number) {
  // A profile photo IS the hero: it fills the card a stranger decides on, so
  // an upscaled thumbnail off a chat app is soft at exactly the size that
  // matters. This is one of the two callers the floor is for; the pipeline's
  // default is off because the same function carries chat and group photos,
  // where a small screenshot is legitimate.
  const storagePath = await processAndUploadImage(PHOTO_BUCKET, userId, localUri, {
    fillsAFrame: true,
  });
  const { data, error } = await supabase
    .from('profile_photos')
    .insert({ user_id: userId, storage_path: storagePath, position })
    .select()
    .single();
  if (error) {
    await removeUploadedImage(PHOTO_BUCKET, storagePath);
    throw error;
  }
  return data;
}

/**
 * Move photos into new slots, one statement per row, IN THE ORDER GIVEN.
 *
 * The order is the safety property, not an implementation detail: PostgREST
 * cannot carry per-row values in a single PATCH, and the only write a client
 * has on this table is `grant update (position)` (20260816190000:359-362), so
 * an RPC would mean opening a second and wider door to the same rows. The
 * plan comes from features/profile/photo-order.ts, which is where the reason
 * each write can safely happen when it does is written down.
 */
export async function setPhotoPositions(updates: { id: string; position: number }[]) {
  for (const update of updates) {
    // No .select(): a returning clause rides the same grants as select * and
    // this call has nothing to read back.
    const { error } = await supabase
      .from('profile_photos')
      .update({ position: update.position })
      .eq('id', update.id);
    if (error) {
      throw error;
    }
  }
}

export async function deletePhoto(photoId: string, storagePath: string) {
  const { error } = await supabase.from('profile_photos').delete().eq('id', photoId);
  if (error) {
    throw error;
  }
  // storage-js reports failures via the result, not by throwing; an orphaned
  // object is invisible to others (reads require a photo row) but log it so
  // leaks are diagnosable.
  const { error: removeError } = await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
  if (removeError) {
    console.warn(`orphaned storage object ${storagePath}: ${removeError.message}`);
  }
}

/** The bucket is private; photos are served via short-lived signed URLs. */
export async function signedPhotoUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) {
    throw error;
  }
  return data.signedUrl;
}

/**
 * Own account standing (users row is self-readable only). Suspended/banned
 * accounts are gated at the root navigator — and, independently, at the DB
 * layer, so this is UX, not enforcement.
 */
export async function fetchAccountStanding(userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('status, suspended_until')
    .eq('id', userId)
    .single();
  if (error) {
    throw error;
  }
  return data;
}

export async function fetchLatestVerification(userId: string) {
  const { data, error } = await supabase
    .from('verification_requests')
    .select(VERIFICATION_REQUEST_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as VerificationRequestRow | null;
}

/**
 * Upload a selfie into the write-only verification bucket and open a
 * verification request. The selfie is only ever read server-side (the
 * moderation worker compares it against profile photos, then deletes it).
 */
export async function submitVerificationSelfie(userId: string, localUri: string) {
  const storagePath = await processAndUploadImage(VERIFICATION_BUCKET, userId, localUri);
  const { data, error } = await supabase.rpc('submit_verification', {
    p_storage_path: storagePath,
  });
  if (error) {
    await removeUploadedImage(VERIFICATION_BUCKET, storagePath);
    throw error;
  }
  return data;
}

/**
 * Who can see you on the map and in Travelers. The column behind these has
 * no client grant in either direction: reading it directly would leak one
 * traveler's setting to another, and writing it directly would route around
 * the rule that narrowing your audience costs a verified badge. Both go
 * through RPCs that own that rule.
 */
export async function fetchOwnVisibility() {
  const { data, error } = await supabase.rpc('my_visibility');
  if (error) {
    throw error;
  }
  return (data ?? 'everyone') as ProfileAudience;
}

export async function setOwnVisibility(audience: ProfileAudience) {
  const { data, error } = await supabase.rpc('set_visibility', { p_audience: audience });
  if (error) {
    throw error;
  }
  return (data ?? audience) as ProfileAudience;
}

/**
 * Permanently delete the signed-in account (App Review 5.1.1(v)). The Edge
 * Function removes storage objects, hard-deletes the user's chats for both
 * members, then deletes the auth user — cascading the whole profile.
 */
export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke('delete-account');
  if (error) {
    throw error;
  }
  // The remembered address is kept across an uninstall on purpose (founder
  // decision D39), so the one thing that must clear it is the person saying
  // this account is gone. Here rather than at the two call sites, so both
  // the traveler branch and the business branch get it.
  await forgetLastEmail();
  await forgetAppleUser();
  return data as { deleted: boolean };
}

export async function fetchOwnSocialHandles(userId: string) {
  const { data, error } = await supabase
    .from('social_handles')
    .select('*')
    .eq('user_id', userId)
    .order('platform');
  if (error) {
    throw error;
  }
  return data;
}

export async function upsertSocialHandle(userId: string, platform: SocialPlatform, handle: string) {
  const { data, error } = await supabase
    .from('social_handles')
    .upsert({ user_id: userId, platform, handle }, { onConflict: 'user_id,platform' })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}

export async function deleteSocialHandle(handleId: string) {
  const { error } = await supabase.from('social_handles').delete().eq('id', handleId);
  if (error) {
    throw error;
  }
}
