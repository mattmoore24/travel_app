import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { PROFILE_COLUMNS, type ProfileUpdate, type SocialPlatform } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export const PHOTO_BUCKET = 'profile-photos';
const PHOTO_MAX_DIMENSION = 1440;
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

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Downscale + JPEG-compress a picked image, upload it under the owner's
 * storage folder (<user_id>/<random>.jpg — the write policy keys off that
 * prefix), then register it in profile_photos (which runs the moderation
 * stub server-side).
 */
export async function uploadPhoto(userId: string, localUri: string, position: number) {
  const context = ImageManipulator.manipulate(localUri);
  context.resize({ width: PHOTO_MAX_DIMENSION });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });

  const storagePath = `${userId}/${randomId()}.jpg`;
  const response = await fetch(result.uri);
  const body = await response.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(storagePath, body, { contentType: 'image/jpeg' });
  if (uploadError) {
    throw uploadError;
  }

  const { data, error } = await supabase
    .from('profile_photos')
    .insert({ user_id: userId, storage_path: storagePath, position })
    .select()
    .single();
  if (error) {
    // Don't leave an orphaned object behind if the row insert failed.
    const { error: cleanupError } = await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
    if (cleanupError) {
      console.warn(`orphaned storage object ${storagePath}: ${cleanupError.message}`);
    }
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
