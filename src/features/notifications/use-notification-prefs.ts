import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useOwnUserId } from '@/features/profile/hooks';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * The one notification switch this app has of its own.
 *
 * Everything else is the OS switch or a per-conversation mute. This covers
 * the three within-trip clocks and NOTHING ELSE: a reply, a hello and an
 * account notice never consult it, which is asserted in pgTAP because an
 * opt-out from a digest that silenced a conversation would be a far worse
 * bug than the one the clocks fix.
 *
 * Named columns rather than `select *`: notification_prefs is not on the list
 * of tables the app star-reads (supabase/tests/database/31), and it stays off
 * it so a future column cannot break this read.
 *
 * Absent row means on. The table is written the first time somebody touches
 * the switch, so an account that never opens Settings has no row and gets the
 * default - which is what the SQL's own `coalesce(np.trip_clocks, true)`
 * says too.
 */
export function useTripClocks() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notification-prefs', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_prefs')
        .select('trip_clocks')
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data?.trip_clocks ?? true;
    },
    enabled: isSupabaseConfigured && userId != null,
  });

  const set = useMutation({
    mutationFn: async (on: boolean) => {
      if (userId == null) {
        return;
      }
      const { error } = await supabase
        .from('notification_prefs')
        .upsert({ user_id: userId, trip_clocks: on }, { onConflict: 'user_id' });
      if (error) {
        throw error;
      }
    },
    meta: { failureTitle: "Couldn't save that" },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-prefs', userId] });
    },
  });

  return {
    // Default on while the answer is still loading, so the switch does not
    // flick from off to on in front of somebody.
    on: query.data ?? true,
    set: (next: boolean) => set.mutate(next),
    saving: set.isPending,
  };
}
