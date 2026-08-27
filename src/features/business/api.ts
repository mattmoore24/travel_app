import type { BusinessCategory, MyBusinessRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

/**
 * The caller's own business, or null.
 *
 * One RPC rather than a table read, and not for convenience: a client holds
 * no SELECT grant on `owner_user_id`, so `where owner_user_id = auth.uid()`
 * is a permission error even for the owner, and a plain select returns every
 * listed place with no way to tell which one is yours. The same call is how
 * the app answers "is this account a business at all", which is the question
 * the router asks before it decides which tabs to mount.
 */
export async function fetchOwnBusiness() {
  const { data, error } = await supabase.rpc('my_business');
  if (error) {
    throw error;
  }
  return ((data ?? []) as MyBusinessRow[])[0] ?? null;
}

export async function registerBusiness(input: {
  name: string;
  category: BusinessCategory;
  cityId: number;
  lat: number;
  lng: number;
}) {
  const { data, error } = await supabase.rpc('register_business', {
    p_name: input.name,
    p_category: input.category,
    p_city_id: input.cityId,
    p_lat: input.lat,
    p_lng: input.lng,
  });
  if (error) {
    throw error;
  }
  return data as string;
}

/**
 * Edit the parts of a listing a business owns.
 *
 * Filtered by `id`, never by `owner_user_id`: the column has no client grant,
 * and Postgres needs SELECT on every column a statement names, including in a
 * WHERE. RLS does the scoping instead, so a request for somebody else's id
 * simply changes nothing.
 */
export async function updateOwnBusiness(
  businessId: string,
  patch: {
    name?: string;
    description?: string | null;
    place_label?: string | null;
    hours_note?: string | null;
    website_url?: string | null;
    public_preview?: boolean;
  }
) {
  const { error } = await supabase.from('businesses').update(patch).eq('id', businessId);
  if (error) {
    throw error;
  }
}
