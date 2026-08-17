import {
  PROFILE_COLUMNS,
  VERIFICATION_REQUEST_COLUMNS,
  type ProfileUpdate,
  type SocialPlatform,
  type VerificationRequestRow,
} from '@/lib/database.types';
import { processAndUploadImage, removeUploadedImage } from '@/lib/image-upload';
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
  const storagePath = await processAndUploadImage(PHOTO_BUCKET, userId, localUri);
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
 * Permanently delete the signed-in account (App Review 5.1.1(v)). The Edge
 * Function removes storage objects, hard-deletes the user's chats for both
 * members, then deletes the auth user — cascading the whole profile.
 */
export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke('delete-account');
  if (error) {
    throw error;
  }
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
