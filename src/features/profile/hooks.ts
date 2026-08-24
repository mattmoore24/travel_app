import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/store';
import {
  deletePhoto,
  deleteProfilePrompt,
  deleteSocialHandle,
  fetchAccountStanding,
  fetchLatestVerification,
  fetchOwnProfile,
  fetchOwnSocialHandles,
  fetchOwnVisibility,
  fetchPhotos,
  fetchProfilePrompts,
  fetchPublicProfile,
  saveProfilePrompt,
  setOwnVisibility,
  signedPhotoUrl,
  submitVerificationSelfie,
  updateOwnProfile,
  uploadPhoto,
  upsertSocialHandle,
} from '@/features/profile/api';
import type {
  ProfileAudience,
  ProfilePhotoRow,
  ProfileUpdate,
  SocialPlatform,
} from '@/lib/database.types';
import { analytics } from '@/lib/analytics';
import { invalidateDiscoverySurfaces } from '@/features/profile/discovery-cache';
import { isSupabaseConfigured } from '@/lib/supabase';

export function useOwnUserId() {
  return useAuthStore((s) => s.session?.user.id ?? null);
}

/** The address the account signs in with, for prefilling a reply-to field. */
export function useOwnEmail() {
  return useAuthStore((s) => s.session?.user.email ?? null);
}

export function useOwnProfile() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchOwnProfile(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

/** Someone else's profile + approved photos, as far as RLS lets us see. */
export function usePublicProfile(userId: string | null) {
  return useQuery({
    queryKey: ['public-profile', userId],
    queryFn: () => fetchPublicProfile(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

/**
 * The prompts on a profile. Same query for your own and somebody else's —
 * RLS decides what comes back, and the profile page renders both the same
 * way so you always see yours as others see it.
 */
export function useProfilePrompts(userId: string | null) {
  return useQuery({
    queryKey: ['profile-prompts', userId],
    queryFn: () => fetchProfilePrompts(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useSaveProfilePrompt() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { slot: number; promptKey: string; answer: string }) =>
      saveProfilePrompt({ userId: userId!, ...input }),
    onSuccess: () => {
      analytics.capture('profile_prompt_saved');
      queryClient.invalidateQueries({ queryKey: ['profile-prompts', userId] });
    },
  });
}

export function useDeleteProfilePrompt() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slot: number) => deleteProfilePrompt(userId!, slot),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile-prompts', userId] });
    },
  });
}

export function usePublicPhotos(userId: string | null) {
  return useQuery({
    queryKey: ['public-photos', userId],
    queryFn: () => fetchPhotos(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useUpdateOwnProfile() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfileUpdate) => updateOwnProfile(userId!, patch),
    onSuccess: (profile) => {
      queryClient.setQueryData(['profile', userId], profile);
    },
  });
}

export function useOwnPhotos() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['photos', userId],
    queryFn: () => fetchPhotos(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useUploadPhoto() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ localUri, position }: { localUri: string; position: number }) =>
      uploadPhoto(userId!, localUri, position),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos', userId] });
    },
  });
}

export function useDeletePhoto() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photo: ProfilePhotoRow) => deletePhoto(photo.id, photo.storage_path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos', userId] });
    },
  });
}

/** Signed URL for a photo in the private bucket (cached just under its TTL). */
export function usePhotoUrl(storagePath: string | null) {
  return useQuery({
    queryKey: ['photo-url', storagePath],
    queryFn: () => signedPhotoUrl(storagePath!),
    enabled: isSupabaseConfigured && storagePath != null,
    staleTime: 50 * 60 * 1000,
    gcTime: 55 * 60 * 1000,
  });
}

/** Own users row (status + suspension expiry) — drives the account gate. */
export function useAccountStanding() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['account-standing', userId],
    queryFn: () => fetchAccountStanding(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useLatestVerification() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['verification', userId],
    queryFn: () => fetchLatestVerification(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useSubmitVerification() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (localUri: string) => submitVerificationSelfie(userId!, localUri),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verification', userId] });
    },
  });
}

/**
 * Who can see you on the map and in Travelers. Not part of useOwnProfile:
 * the column has no client SELECT grant precisely so one traveler's setting
 * is not readable by another, so it comes back through its own RPC.
 */
export function useOwnVisibility() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['visibility', userId],
    queryFn: fetchOwnVisibility,
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useSetVisibility() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (audience: ProfileAudience) => setOwnVisibility(audience),
    onSuccess: (audience) => {
      queryClient.setQueryData(['visibility', userId], audience);
      // The setting cuts both ways, so every discovery surface is now showing
      // a queue and a map built for the old audience. The list of them lives
      // in discovery-cache because this call site got it wrong once: it named
      // the web list's key and not the native map's, so on a phone it
      // invalidated nothing and the map sat on the old audience for up to a
      // minute. That was the "takes a while to update".
      invalidateDiscoverySurfaces(queryClient);
    },
  });
}

export function useOwnSocialHandles() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['social-handles', userId],
    queryFn: () => fetchOwnSocialHandles(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useUpsertSocialHandle() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ platform, handle }: { platform: SocialPlatform; handle: string }) =>
      upsertSocialHandle(userId!, platform, handle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-handles', userId] });
    },
  });
}

export function useDeleteSocialHandle() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (handleId: string) => deleteSocialHandle(handleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-handles', userId] });
    },
  });
}
