import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/store';
import {
  deletePhoto,
  deleteSocialHandle,
  fetchAccountStanding,
  fetchLatestVerification,
  fetchOwnProfile,
  fetchOwnSocialHandles,
  fetchPhotos,
  fetchPublicProfile,
  signedPhotoUrl,
  submitVerificationSelfie,
  updateOwnProfile,
  uploadPhoto,
  upsertSocialHandle,
} from '@/features/profile/api';
import type { ProfilePhotoRow, ProfileUpdate, SocialPlatform } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

export function useOwnUserId() {
  return useAuthStore((s) => s.session?.user.id ?? null);
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
