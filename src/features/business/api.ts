import {
  BUSINESS_VERIFICATION_COLUMNS,
  type BusinessCategory,
  type BusinessDetailRow,
  type BusinessReportReason,
  type BusinessVerificationRow,
  type CityBusinessRow,
  type MyBusinessRow,
  type MyRatingRow,
  type RatingBucket,
  type RatingSummaryRow,
  type RatingTag,
  type TopRatedRow,
} from '@/lib/database.types';
import { processAndUploadImage, removeUploadedImage } from '@/lib/image-upload';
import { supabase } from '@/lib/supabase';

/** Storefront evidence. Never rendered on a listing; see the §3.9 design. */
export const BUSINESS_VERIFICATION_BUCKET = 'business-verification';
export const BUSINESS_PHOTO_BUCKET = 'business-photos';

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

/** Every place on the map in one city. */
export async function fetchCityBusinesses(cityId: number) {
  const { data, error } = await supabase.rpc('city_businesses', { p_city_id: cityId });
  if (error) {
    throw error;
  }
  return (data ?? []) as CityBusinessRow[];
}

/** One place's whole page, in one round trip. */
export async function fetchBusinessDetail(businessId: string) {
  const { data, error } = await supabase.rpc('business_detail', { p_business_id: businessId });
  if (error) {
    throw error;
  }
  return ((data ?? []) as BusinessDetailRow[])[0] ?? null;
}

// -- Getting listed -----------------------------------------------------------

export async function requestBusinessEmailCode(email: string) {
  const { error } = await supabase.rpc('request_business_email_confirmation', { p_email: email });
  if (error) {
    throw error;
  }
}

export async function confirmBusinessEmail(code: string) {
  const { error } = await supabase.rpc('confirm_business_email', { p_code: code });
  if (error) {
    throw error;
  }
}

// -- The badge ----------------------------------------------------------------

/**
 * Upload both storefront shots and open the check.
 *
 * Upload first, RPC second, with a compensating delete on failure, exactly
 * like the selfie path: the RPC verifies both objects exist before it opens a
 * row, so an orphaned upload is better than a row pointing at nothing.
 */
export async function submitStorefrontPhotos(userId: string, wideUri: string, closeUri: string) {
  const widePath = await processAndUploadImage(BUSINESS_VERIFICATION_BUCKET, userId, wideUri);
  let closePath: string | null = null;
  try {
    closePath = await processAndUploadImage(BUSINESS_VERIFICATION_BUCKET, userId, closeUri);
    const { error } = await supabase.rpc('submit_business_verification', {
      p_wide_path: widePath,
      p_close_path: closePath,
    });
    if (error) {
      throw error;
    }
  } catch (error) {
    await removeUploadedImage(BUSINESS_VERIFICATION_BUCKET, widePath);
    if (closePath) {
      await removeUploadedImage(BUSINESS_VERIFICATION_BUCKET, closePath);
    }
    throw error;
  }
}

export async function fetchLatestStorefrontCheck(businessId: string) {
  const { data, error } = await supabase
    .from('business_verifications')
    .select(BUSINESS_VERIFICATION_COLUMNS)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as BusinessVerificationRow | null) ?? null;
}

// -- What a traveler does with a place ----------------------------------------

export async function reportBusiness(input: {
  businessId: string;
  reason: BusinessReportReason;
  note?: string;
}) {
  const { error } = await supabase.rpc('report_business', {
    p_business_id: input.businessId,
    p_reason: input.reason,
    p_note: input.note ?? null,
  });
  if (error) {
    throw error;
  }
}

export async function messageBusiness(businessId: string, firstMessage: string) {
  const { data, error } = await supabase.rpc('message_business', {
    p_business_id: businessId,
    p_first_message: firstMessage,
  });
  if (error) {
    throw error;
  }
  return data as { chat_id?: string; blocked: boolean; existing?: boolean };
}

// -- Ratings -------------------------------------------------------------------

export async function fetchRatingSummary(businessId: string) {
  const { data, error } = await supabase.rpc('business_rating_summary', {
    p_business_id: businessId,
  });
  if (error) {
    throw error;
  }
  return ((data ?? []) as RatingSummaryRow[])[0] ?? null;
}

/** The caller's own ranked list in one category, which the comparisons walk. */
export async function fetchMyRatings(category: BusinessCategory) {
  const { data, error } = await supabase.rpc('my_ratings', { p_category: category });
  if (error) {
    throw error;
  }
  return (data ?? []) as MyRatingRow[];
}

export async function rateBusiness(input: {
  businessId: string;
  bucket: RatingBucket;
  rank: number;
  tags?: RatingTag[];
}) {
  const { data, error } = await supabase.rpc('rate_business', {
    p_business_id: input.businessId,
    p_bucket: input.bucket,
    p_rank: input.rank,
    p_tags: input.tags ?? [],
  });
  if (error) {
    throw error;
  }
  return data as { score: number };
}

export async function fetchTopRated(userId: string, cityId?: number | null) {
  const { data, error } = await supabase.rpc('top_rated_by', {
    p_user_id: userId,
    p_city_id: cityId ?? null,
  });
  if (error) {
    throw error;
  }
  return (data ?? []) as TopRatedRow[];
}
