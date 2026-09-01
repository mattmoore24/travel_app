import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/store';
import {
  deletePhoto,
  deleteProfilePriority,
  deleteProfilePrompt,
  deleteSocialHandle,
  fetchAccountStanding,
  fetchLatestVerification,
  fetchOwnProfile,
  fetchOwnSocialHandles,
  fetchOwnVisibility,
  fetchPhotos,
  fetchProfilePriorities,
  fetchProfilePrompts,
  fetchPublicProfile,
  removeProfilePriority,
  saveProfilePriority,
  saveProfilePrompt,
  setOwnVisibility,
  setPhotoPositions,
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

/**
 * The Top priorities list on a profile. Same query for your own and somebody
 * else's, for the same reason prompts are: RLS decides what comes back and
 * the page renders both identically, so you always see yours as a stranger
 * does.
 */
export function useProfilePriorities(userId: string | null) {
  return useQuery({
    queryKey: ['profile-priorities', userId],
    queryFn: () => fetchProfilePriorities(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useSaveProfilePriority() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { slot: number; text: string }) =>
      saveProfilePriority({ userId: userId!, ...input }),
    onSuccess: () => {
      analytics.capture('profile_priority_saved');
      queryClient.invalidateQueries({ queryKey: ['profile-priorities', userId] });
    },
  });
}

/**
 * Remove one and close the hole. The editor hands over the list it is looking
 * at, because the renumbering has to be computed against the same rows the
 * person can see rather than against a cache that may have moved on.
 */
export function useRemoveProfilePriority() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { slot: number; rows: { slot: number; text: string }[] }) =>
      removeProfilePriority(userId!, input.slot, input.rows),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile-priorities', userId] });
    },
  });
}

/** Only used when a row fails to save and has to be dropped on its own. */
export function useDeleteProfilePriority() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slot: number) => deleteProfilePriority(userId!, slot),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile-priorities', userId] });
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
    onSuccess: (_data, { position }) => {
      // On the mutation, not in PhotoGrid, so loss
      // inside the iOS permission chain is separable from loss on signup's
      // Continue button: a photo that lands emits this even if the person
      // then quits on the gate.
      analytics.capture('profile_photo_added', { position });
      // RETURNED, so mutateAsync does not resolve until the refetch has
      // landed. That is what lets PhotoGrid retire its local tile the moment
      // the await returns, with the real row already on screen: dropping it
      // any earlier flashes the empty dashed box, and keeping it any longer
      // means keeping a dead entry that reappears the next time that slot is
      // freed.
      return queryClient.invalidateQueries({ queryKey: ['photos', userId] });
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

/**
 * Move a photo to a new place in the order, and with it decide which one
 * leads.
 *
 * Optimistic, because this is a rearrangement somebody is doing with their
 * eyes on the grid: waiting several round trips to see the tile move would
 * read as a broken drag. The plan is computed by the caller (photo-order.ts)
 * so the same arithmetic that produced the new list produced the writes.
 */
export function useReorderPhotos() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      writes,
    }: {
      writes: { id: string; position: number }[];
      next: ProfilePhotoRow[];
    }) => setPhotoPositions(writes),
    onMutate: async ({ next }) => {
      // Cancel first, or a refetch already in flight lands the old order on
      // top of the optimistic one.
      await queryClient.cancelQueries({ queryKey: ['photos', userId] });
      const previous = queryClient.getQueryData<ProfilePhotoRow[]>(['photos', userId]);
      queryClient.setQueryData(['photos', userId], next);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['photos', userId], context.previous);
      }
    },
    onSuccess: () => {
      analytics.capture('profile_photos_reordered');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['photos', userId] });
      // The public copy is a different key, and the hero it feeds is the
      // whole point of the reorder.
      queryClient.invalidateQueries({ queryKey: ['public-photos', userId] });
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
