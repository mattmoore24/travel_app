import {
  BUSINESS_VERIFICATION_COLUMNS,
  type BusinessCategory,
  type BusinessDetailRow,
  type BusinessLinkKind,
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
  /** As typed or picked. Never derived from the marker; see the migration. */
  address?: string | null;
}) {
  const { data, error } = await supabase.rpc('register_business', {
    p_name: input.name,
    p_category: input.category,
    p_city_id: input.cityId,
    p_lat: input.lat,
    p_lng: input.lng,
    p_address: input.address ?? null,
  });
  if (error) {
    throw error;
  }
  return data as string;
}

/**
 * Move a listing that already exists.
 *
 * `lat`, `lng` and `city_id` are deliberately withheld from the client's
 * UPDATE grant — a business that could move its own marker could verify a
 * surf shack and then become the Marriott — so this SECURITY DEFINER function
 * is the only door, and it re-runs the city radius check on the way through.
 *
 * `clearAddress` exists because null means two different things through an
 * optional parameter: "leave the address alone" and "the owner deleted it".
 */
export async function updateBusinessLocation(input: {
  lat: number;
  lng: number;
  cityId?: number | null;
  address?: string | null;
  clearAddress?: boolean;
}) {
  const { error } = await supabase.rpc('update_business_location', {
    p_lat: input.lat,
    p_lng: input.lng,
    p_city_id: input.cityId ?? null,
    p_address: input.address ?? null,
    p_clear_address: input.clearAddress ?? false,
  });
  if (error) {
    throw error;
  }
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
    address?: string | null;
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

/**
 * One contact row on a business's page.
 *
 * Shared with business-edit rather than duplicated: signup collects a phone
 * and a WhatsApp number the same way the editor does forever afterwards, and
 * the same validator trigger judges both (a phone must look like a phone, a
 * link must be https with a real domain, ten is plenty).
 */
export async function addBusinessLink(input: {
  businessId: string;
  kind: BusinessLinkKind;
  label: string;
  value: string;
  position: number;
}) {
  const { error } = await supabase.from('business_links').insert({
    business_id: input.businessId,
    kind: input.kind,
    label: input.label,
    value: input.value,
    position: input.position,
  });
  if (error) {
    throw error;
  }
}

/** The three ways to reach a business that signup collects. */
export const CONTACT_KINDS = ['email', 'phone', 'whatsapp'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/**
 * Set a business's contact rows to exactly what was typed.
 *
 * REPLACE, not append. `addBusinessLink` is a blind insert, and signup's
 * contact step is reachable more than once — step 7's Back leads to it, and
 * so does "Use a different address" from the code screen. Appending meant an
 * ordinary correction left two emails and two phone numbers on the public
 * page, with the traveler-facing address no longer matching the one the
 * confirmation code went to.
 *
 * Returns the kinds the database refused rather than throwing. A phone number
 * the validator will not take must not cost somebody the listing they have
 * already registered, which is why this never threw — but silence was the
 * wrong other half: the number simply vanished. The caller names them.
 */
export async function replaceBusinessContacts(input: {
  businessId: string;
  email: string;
  phone: string;
  whatsapp: string;
}): Promise<ContactKind[]> {
  const { error: clearError } = await supabase
    .from('business_links')
    .delete()
    .eq('business_id', input.businessId)
    .in('kind', [...CONTACT_KINDS]);
  if (clearError) {
    throw clearError;
  }

  const rows: { kind: ContactKind; label: string; value: string }[] = [
    { kind: 'email', label: 'Email', value: input.email.trim() },
    { kind: 'phone', label: 'Phone', value: input.phone.trim() },
    { kind: 'whatsapp', label: 'WhatsApp', value: input.whatsapp.trim() },
  ];

  const refused: ContactKind[] = [];
  let position = 0;
  for (const row of rows) {
    if (row.value.length === 0) {
      continue;
    }
    try {
      await addBusinessLink({ businessId: input.businessId, ...row, position });
      position += 1;
    } catch {
      refused.push(row.kind);
    }
  }
  return refused;
}

export async function requestBusinessEmailCode(email: string) {
  const { error } = await supabase.rpc('request_business_email_confirmation', { p_email: email });
  if (error) {
    throw error;
  }
}

export type CodeDelivery = {
  sent_at?: string;
  delivered?: boolean;
  attempts?: number;
  /** The mailer tried and the mail did not go. A different address is the fix. */
  failed?: boolean;
};

/**
 * Did the code actually leave?
 *
 * The mailer has always recorded a refusal and nothing ever read it, so a
 * screen went on saying "check your inbox" about mail a provider had already
 * declined to carry. The server hands back four facts and never the
 * provider's own error text.
 */
export async function businessCodeStatus(): Promise<CodeDelivery> {
  const { data, error } = await supabase.rpc('my_business_code_status');
  if (error) {
    throw error;
  }
  return (data ?? {}) as CodeDelivery;
}

/**
 * `first_time` false means the code had already been used.
 *
 * Worth carrying to the client rather than swallowing: a rename sends a
 * listed place back to `unconfirmed`, and the obvious move is to retype the
 * code still sitting in the inbox. That path now relists (the server does it
 * on both branches), so the screen can say which of the two just happened
 * instead of firing the same success haptic for both.
 */
export async function confirmBusinessEmail(code: string) {
  const { data, error } = await supabase.rpc('confirm_business_email', { p_code: code });
  if (error) {
    throw error;
  }
  return (data ?? { confirmed: true, first_time: true }) as {
    confirmed: boolean;
    first_time: boolean;
  };
}

/**
 * Take a post down.
 *
 * An archive rather than a delete, matching `archive_expired_posts()`: the
 * row is the record of what a place said it was doing, and moderation reads
 * it. Travelers stop seeing it either way — `business_detail` and
 * `city_businesses` both filter on `archived_at is null`.
 *
 * This exists because the composer had no counterpart. The cap is three live
 * posts unverified and ten verified, enforced by a trigger, and the third
 * shape a post can take is "keep it up until I take it down" — so a new place
 * could put up three standing notices and permanently lock itself out of its
 * own composer, which then told it to "take one down" with nowhere to do it.
 */
export async function archiveBusinessPost(postId: string) {
  const { error } = await supabase
    .from('business_posts')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', postId);
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
  return data as {
    chat_id?: string;
    blocked: boolean;
    existing?: boolean;
    /** Which kind of wrong ('sexual', 'flirtation'); only on blocked. */
    category?: string | null;
  };
}

/**
 * Which place a chat belongs to, or null if it belongs to a person.
 *
 * The chat list row cannot answer this: `my_chats` carries `other_user_id`,
 * which for a business chat is the OWNER's auth id, and pushing that at
 * `/profile/[userId]` opens a stub personal profile rather than the bar.
 */
export async function fetchBusinessForChat(chatId: string) {
  const { data, error } = await supabase.rpc('business_for_chat', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
  return (data ?? null) as string | null;
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
