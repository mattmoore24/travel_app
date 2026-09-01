import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useAuthStore } from '@/features/auth/store';
import {
  archiveBusinessPost,
  businessCodeStatus,
  confirmBusinessEmail,
  fetchBusinessForChat,
  fetchBusinessDetail,
  fetchCityBusinesses,
  fetchLatestStorefrontCheck,
  fetchListingIntent,
  setListingIntent,
  fetchMyRatings,
  fetchOwnBusiness,
  fetchRatingSummary,
  fetchTopRated,
  messageBusiness,
  rateBusiness,
  registerBusiness,
  reportBusiness,
  requestBusinessEmailCode,
  submitStorefrontPhotos,
  updateBusinessLocation,
  updateOwnBusiness,
} from '@/features/business/api';
import type { BusinessCategory, ChatKind } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * The account's own business, or null if it is a person.
 *
 * This is the account-kind question, and the router asks it before it decides
 * which tabs to mount. Keyed on the user id so signing out and back in as
 * somebody else cannot serve the previous account's answer.
 */
export function useOwnBusiness() {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const anonymous = useAuthStore((s) => s.session?.user.is_anonymous === true);
  return useQuery({
    queryKey: ['my-business', userId],
    queryFn: fetchOwnBusiness,
    // A guest is an anonymous session with no profile and no business, and
    // asking on their behalf is a round trip whose answer is always null.
    enabled: isSupabaseConfigured && userId != null && !anonymous,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Whether this account is part way through listing a business, from the
 * database rather than from memory.
 *
 * The in-memory flag in the auth store is still the fast path within one
 * sitting; this is what survives a cold start. Steps 4 to 11 of the listing
 * form had no exit at all, so the real abandonment was killing the app, and
 * the flag went with it: the account came back reading as a traveler who had
 * not finished, and the bar owner was asked for their first name in the one
 * flow a business must never complete.
 *
 * Same shape and same guard as useOwnBusiness above, because the router asks
 * both before it decides which stack to mount.
 */
export function useListingIntent() {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const anonymous = useAuthStore((s) => s.session?.user.is_anonymous === true);
  return useQuery({
    queryKey: ['listing-intent', userId],
    queryFn: fetchListingIntent,
    enabled: isSupabaseConfigured && userId != null && !anonymous,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Write the listing intent AND repair the cache that gates on it.
 *
 * The bare api call is not enough anywhere, and the failure is invisible in
 * testing. useListingIntent is enabled the instant a new session lands —
 * which is inside the awaited signUpWithEmail — so the read races the write,
 * frequently answers against a pre-write snapshot, and then caches `false`
 * for five minutes with nothing to invalidate it. The router reads that
 * false, decides the account is an unfinished traveler, and filters `(tabs)`
 * out of the navigator; the listing form's own "Finish this later" then
 * replaces to a route that is not mounted and silently does nothing, which
 * is the dead-button trap the traps skill names. Seeding the cache from the
 * write is what closes it: the write is the newer truth, so it does not need
 * to be re-read to be believed.
 */
export function useRecordListingIntent() {
  const queryClient = useQueryClient();
  return useCallback(
    async (wants: boolean) => {
      await setListingIntent(wants);
      const userId = useAuthStore.getState().session?.user.id ?? null;
      queryClient.setQueryData(['listing-intent', userId], wants);
    },
    [queryClient]
  );
}

/**
 * Put the listing intent down for good.
 *
 * The flag is otherwise one-way: it keeps the tabs mounted, traveler
 * onboarding is never asked for again, and the profile keeps offering a form
 * the person has decided against. Invalidates its own query so the row
 * disappears without a relaunch.
 */
export function useDropListingIntent() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  return useMutation({
    mutationFn: () => setListingIntent(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listing-intent', userId] });
    },
  });
}

/**
 * Whether this account runs a business.
 *
 * One name for the question every surface was asking as
 * `useOwnBusiness().data != null`. The founder's rule is absolute — "under no
 * circumstances should a business account ever have the option to join a chat
 * of any other business or other pin of any kind" — and a rule that absolute
 * should read the same everywhere it is enforced.
 *
 * The database says no too (assert_not_business, 20260829190000). This is the
 * half that means nobody is ever offered the button: a refusal somebody could
 * not have predicted is worse than no button at all.
 */
export function useIsBusiness() {
  return useOwnBusiness().data != null;
}

export function useRegisterBusiness() {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerBusiness,
    onSuccess: () => {
      // The account has just changed KIND, so the router's answer has changed
      // with it. Anything less than a refetch leaves a fresh business sitting
      // in the traveler tabs.
      //
      // NOTHING ELSE GOES IN HERE, and the reason is written on this file's
      // sibling test. Registering flips a guard, and a guard flip filters a
      // route out of the navigator UNDERNEATH whichever business screen is
      // showing; react-native-screens then has to reshuffle a stack whose
      // first entry is a modal, and the app dies. The founder hit that once
      // already, typing a confirmation code.
      //
      // A review finding asked for `setListingIntent(false)` here, on the
      // grounds that nothing ever lowers wants_business for a listing that
      // succeeded, so the column comes to mean "has ever started a listing".
      // That is true and it is cosmetic. Adding the write killed the listing
      // flow on its confirm step in two consecutive e2e runs, in both
      // orderings — before the refetch and after it — because the write is a
      // second guard-flipping fact landing in the same moment as the first.
      // isBusiness outranks wants_business everywhere it is read
      // (owesOnboarding returns false on isBusiness before it ever looks at
      // the flag), so the drift costs nothing. Leave it.
      queryClient.invalidateQueries({ queryKey: ['my-business', userId] });
    },
  });
}

/**
 * Move the marker, the city, or the address of a listing that already exists.
 *
 * Signup registers the row at the confirm step, so anybody who then walks
 * back to "Where is it?" is editing rather than creating, and the create call
 * is a no-op for them. Without this their correction would be accepted by the
 * screen and quietly dropped.
 */
export function useUpdateBusinessLocation() {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBusinessLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-business', userId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail'] });
      queryClient.invalidateQueries({ queryKey: ['city-businesses'] });
    },
  });
}

export function useUpdateOwnBusiness(businessId: string | null) {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof updateOwnBusiness>[1]) =>
      updateOwnBusiness(businessId!, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-business', userId] });
      // This mutation owns name, description, place_label, hours_note and
      // website_url — every text field a traveler reads. Without these the
      // owner's dashboard showed the new words and their own "See it as a
      // traveler" page showed the old ones, on the same field, one tap apart.
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      queryClient.invalidateQueries({ queryKey: ['city-businesses'] });
    },
  });
}

/** Take a live post down, which is what frees a slot under the cap. */
export function useArchiveBusinessPost(businessId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveBusinessPost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-posts', businessId] });
      // The marker's "something on" flag is derived from live posts, so the
      // map is wrong the moment the last one comes down.
      queryClient.invalidateQueries({ queryKey: ['city-businesses'] });
    },
  });
}

/**
 * Is this chat a conversation with a PLACE, from where the reader is sitting?
 *
 * `kind = 'business'` is handed to BOTH sides of the conversation, and
 * `my_chats` already flips the title and the photo per reader: the traveler
 * gets the bar, the bar gets the traveler. The client did not flip with it, so
 * a business reading its own inbox saw every traveler dressed as a storefront
 * — a profile-photo path signed against the business bucket, which is a 404
 * wearing a valid-looking URL; the subtitle "The people who run <the
 * traveler's name>"; no verified badge on the one screen where it matters
 * most; and a header that opened the business's own listing.
 *
 * Safe to ask here: the router resolves the account kind before any chat
 * screen mounts, because app/_layout.tsx gates the whole stack on it.
 */
export function useIsPlaceChat(kind: ChatKind | null | undefined): boolean {
  const iAmTheBusiness = useOwnBusiness().data != null;
  return kind === 'business' && !iAmTheBusiness;
}

/** The place a chat belongs to. Asked only for `kind === 'business'` rows. */
export function useBusinessForChat(chatId: string | null) {
  return useQuery({
    queryKey: ['business-for-chat', chatId],
    queryFn: () => fetchBusinessForChat(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
    staleTime: 10 * 60 * 1000,
  });
}

export type { BusinessCategory };

export function useCityBusinesses(cityId: number | null) {
  return useQuery({
    queryKey: ['city-businesses', cityId],
    queryFn: () => fetchCityBusinesses(cityId!),
    enabled: isSupabaseConfigured && cityId != null,
  });
}

export function useBusinessDetail(businessId: string | null) {
  return useQuery({
    queryKey: ['business-detail', businessId],
    queryFn: () => fetchBusinessDetail(businessId!),
    enabled: isSupabaseConfigured && businessId != null,
  });
}

export function useRequestBusinessEmailCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: requestBusinessEmailCode,
    onSuccess: () => {
      // A fresh code means a fresh queue row, and the old row's verdict is
      // about mail nobody is waiting for any more.
      queryClient.invalidateQueries({ queryKey: ['business-code-status'] });
    },
  });
}

/**
 * Whether the last code actually went out.
 *
 * Polled while somebody is looking at an empty six-digit box, because that is
 * exactly the minute in which "we sent it" turning out to be false is worth
 * knowing. Stops polling once the answer is in: delivered is the end of the
 * story, and so is failed.
 */
export function useBusinessCodeStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['business-code-status'],
    queryFn: businessCodeStatus,
    enabled: isSupabaseConfigured && enabled,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.delivered || data?.failed ? false : 10_000;
    },
  });
}

export function useConfirmBusinessEmail() {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmBusinessEmail,
    onSuccess: () => {
      // The listing just went live, so both the dashboard's state chip and
      // every map that was drawn without it are now wrong.
      queryClient.invalidateQueries({ queryKey: ['my-business', userId] });
      queryClient.invalidateQueries({ queryKey: ['city-businesses'] });
    },
  });
}

export function useLatestStorefrontCheck(businessId: string | null) {
  return useQuery({
    queryKey: ['storefront-check', businessId],
    queryFn: () => fetchLatestStorefrontCheck(businessId!),
    enabled: isSupabaseConfigured && businessId != null,
  });
}

export function useSubmitStorefront(businessId: string | null) {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ wideUri, closeUri }: { wideUri: string; closeUri: string }) =>
      submitStorefrontPhotos(userId!, wideUri, closeUri),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storefront-check', businessId] });
    },
  });
}

export function useReportBusiness() {
  return useMutation({ mutationFn: reportBusiness });
}

export function useMessageBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ businessId, body }: { businessId: string; body: string }) =>
      messageBusiness(businessId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useRatingSummary(businessId: string | null) {
  return useQuery({
    queryKey: ['rating-summary', businessId],
    queryFn: () => fetchRatingSummary(businessId!),
    enabled: isSupabaseConfigured && businessId != null,
  });
}

/** The caller's own ranked list, which the head-to-head cards walk. */
export function useMyRatings(category: BusinessCategory | null) {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  return useQuery({
    queryKey: ['my-ratings', userId, category],
    queryFn: () => fetchMyRatings(category!),
    enabled: isSupabaseConfigured && userId != null && category != null,
  });
}

export function useRateBusiness() {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rateBusiness,
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: ['rating-summary', input.businessId] });
      queryClient.invalidateQueries({ queryKey: ['my-ratings', userId] });
      queryClient.invalidateQueries({ queryKey: ['top-rated', userId] });
    },
  });
}

export function useTopRated(userId: string | null, cityId?: number | null) {
  return useQuery({
    queryKey: ['top-rated', userId, cityId ?? null],
    queryFn: () => fetchTopRated(userId!, cityId ?? null),
    enabled: isSupabaseConfigured && userId != null,
  });
}
