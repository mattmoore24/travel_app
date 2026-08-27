import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/store';
import { fetchOwnBusiness, registerBusiness, updateOwnBusiness } from '@/features/business/api';
import type { BusinessCategory } from '@/lib/database.types';
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

export function useRegisterBusiness() {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerBusiness,
    onSuccess: () => {
      // The account has just changed KIND, so the router's answer has changed
      // with it. Anything less than a refetch leaves a fresh business sitting
      // in the traveler tabs.
      queryClient.invalidateQueries({ queryKey: ['my-business', userId] });
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
    },
  });
}

export type { BusinessCategory };
