import {
  BUSINESS_VERIFICATION_COLUMNS,
  type BusinessCategory,
  type BusinessDetailRow,
  type BusinessLinkKind,
  type BusinessReportReason,
  type BusinessVerificationRow,
  type CityBusinessRow,
  type CityRow,
  type CityWhatsOnRow,
  type ModerationStatus,
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

/**
 * Whether this account is part way through listing a business.
 *
 * A definer function rather than a column read: `wants_business` carries no
 * grant at all, because profiles_select_visible lets any authenticated
 * account read a visible traveler's row and a granted column would have told
 * every reader who is in the middle of putting a bar on the map.
 */
export async function fetchListingIntent() {
  const { data, error } = await supabase.rpc('listing_intent');
  if (error) {
    throw error;
  }
  return data === true;
}

/**
 * Say it, or take it back. Scoped to auth.uid() server-side: there is no
 * parameter for whose flag to set.
 */
export async function setListingIntent(wants: boolean) {
  const { data, error } = await supabase.rpc('set_listing_intent', { p_wants: wants });
  if (error) {
    throw error;
  }
  return data === true;
}

/**
 * Create the caller's one business. No city goes with it: the server files
 * the listing under the city its marker is in (resolve_business_city,
 * 20260905130000), any of the seeded cities, and null is the honest hint
 * from a screen on which nobody chose one.
 */
export async function registerBusiness(input: {
  name: string;
  category: BusinessCategory;
  lat: number;
  lng: number;
  /** As typed or picked. Never derived from the marker; see the migration. */
  address?: string | null;
}) {
  const { data, error } = await supabase.rpc('register_business', {
    p_name: input.name,
    p_category: input.category,
    p_city_id: null,
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
 * is the only door. It resolves the city from the marker on the way through:
 * the stored city is the hint and stands while the marker stays within 20 km
 * of it, otherwise the listing is re-filed under the city the marker is in.
 * `cityId` is kept for the old bundle's sake and no screen passes it now.
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
 * Which city a marker will be filed under, before anything is written: the
 * same resolver register_business and update_business_location run, with the
 * same hint, so "That puts you in Lisbon, Portugal." on the screen, the
 * confirm card and the stored row cannot disagree.
 */
export async function fetchCityForSpot(
  lat: number,
  lng: number,
  hint: number | null
): Promise<CityRow | null> {
  const { data, error } = await supabase.rpc('city_for_spot', {
    p_lat: lat,
    p_lng: lng,
    p_hint: hint,
  });
  if (error) {
    throw error;
  }
  return (data ?? null) as CityRow | null;
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

/**
 * What is on at each business in a city, keyed by business.
 *
 * The twin of `city_businesses.has_live_post`: that boolean is what brightens
 * a marker's ring, and this is the words behind it. Separate from the list
 * itself so the list's own signature never had to move.
 */
async function fetchCityWhatsOn(cityId: number) {
  const { data, error } = await supabase.rpc('city_whats_on', { p_city_id: cityId });
  if (error) {
    throw error;
  }
  return new Map(((data ?? []) as CityWhatsOnRow[]).map((row) => [row.business_id, row]));
}

/**
 * Every place on the map in one city, each carrying what it has on.
 *
 * Two calls rather than one wider `city_businesses`, and the merge is here
 * rather than in a second query so every existing caller reaches the words
 * without a line of plumbing: the map already reads this, hands the rows to
 * the plan list, and the list can now say what the news IS instead of only
 * that there is some.
 *
 * The what's-on half is allowed to fail on its own. JavaScript ships over the
 * air and the database deploys separately, so a phone can be a few minutes
 * ahead of its own server, and losing every business on the map because the
 * new function is not there yet would be a far worse trade than losing a line
 * of text. What is left when it fails is exactly what the list said before
 * this existed, which is true rather than merely quiet.
 */
export async function fetchCityBusinesses(cityId: number) {
  const [{ data, error }, whatsOn] = await Promise.all([
    supabase.rpc('city_businesses', { p_city_id: cityId }),
    fetchCityWhatsOn(cityId).catch((whatsOnError: unknown) => {
      console.warn(`city_whats_on(${cityId}) failed: ${String(whatsOnError)}`);
      return new Map<string, CityWhatsOnRow>();
    }),
  ]);
  if (error) {
    throw error;
  }
  return ((data ?? []) as Omit<CityBusinessRow, 'live_post'>[]).map((place) => ({
    ...place,
    live_post: whatsOn.get(place.id) ?? null,
  }));
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

/** One post as its owner sees it, archived ones included. */
export type OwnBusinessPostRow = {
  id: string;
  business_id: string;
  title: string;
  body: string | null;
  photo_path: string | null;
  /**
   * Where the photo's check has got to. Read straight from the table rather
   * than from `business_detail`, for the reason the photo grid gives beside
   * its own read: that RPC answers for a business a traveler can see, and the
   * composer is open in exactly the cases where it does not answer.
   */
  photo_status: ModerationStatus;
  happens_at: string | null;
  ends_at: string | null;
  archived_at: string | null;
};

/** The columns the composer needs to reopen a post. Never a star select. */
const OWN_POST_COLUMNS =
  'id, business_id, title, body, photo_path, photo_status, happens_at, ends_at, archived_at';

/**
 * Read back one of your own posts, to edit it or to put it up again.
 *
 * `business_posts_select_own` is what makes this work on an ARCHIVED row:
 * `business_posts_select_visible` filters those out for everybody, which is
 * correct for travelers and would make "post this again" impossible. No
 * business id is passed and none is needed - the policy is `owns_business`,
 * so a post id belonging to somebody else's listing comes back as no rows
 * rather than as somebody else's words.
 */
export async function fetchOwnBusinessPost(postId: string): Promise<OwnBusinessPostRow | null> {
  const { data, error } = await supabase
    .from('business_posts')
    .select(OWN_POST_COLUMNS)
    .eq('id', postId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data ?? null) as OwnBusinessPostRow | null;
}

/**
 * Fix a post rather than delete it and retype it.
 *
 * The permission already existed: `grant insert, update, delete` and
 * `business_posts_write_own` cover the whole table, so this is the client
 * half of something the database has always allowed. `screen_business_post`
 * runs on UPDATE too, so an edit is screened exactly as the first draft was
 * (20260827110000), and its cap check deliberately does NOT fire on an edit
 * that leaves `archived_at` alone - an edit puts nothing new up.
 *
 * archived_at is not in the payload and must not be: un-archiving by hand
 * would put a post back up while bypassing nothing at all (the trigger
 * counts that case), but it would skip the composer, and the composer is
 * where somebody sees that last week's date is still on it. Putting a post up
 * again goes through the composer as a new row.
 */
export async function updateBusinessPost(input: {
  postId: string;
  title: string;
  body: string | null;
  photoPath: string | null;
  happensAt: string | null;
  endsAt: string | null;
}) {
  const { error } = await supabase
    .from('business_posts')
    .update({
      title: input.title,
      body: input.body,
      photo_path: input.photoPath,
      happens_at: input.happensAt,
      ends_at: input.endsAt,
    })
    .eq('id', input.postId);
  if (error) {
    throw error;
  }
}

/**
 * Put a picture on a post, and open its check.
 *
 * The bucket is the photo grid's, but that is a detail of where bytes live and
 * nothing else: moderation attaches to the ROW a photo creates, so a post
 * photo is screened by its own trigger on `business_posts` and read through
 * its own arm of `can_view_business_photo`. Sharing a bucket buys none of it.
 *
 * Upload first, write the path second, delete the upload if the write fails —
 * the same order and the same compensation as every other photo path here. The
 * row is what makes an object readable, so an orphan is better than a path
 * pointing at nothing.
 */
export async function uploadPostPhoto(userId: string, localUri: string): Promise<string> {
  // A post photo is drawn at the same width as a listing's cover on the place
  // page, so it is judged the same way and gets the same resolution floor.
  return processAndUploadImage(BUSINESS_PHOTO_BUCKET, userId, localUri, { fillsAFrame: true });
}

/**
 * Forget a post photo that no row points at any more.
 *
 * Best effort by design: storage-js reports a failure in the result rather
 * than by throwing, and an orphaned object is invisible to everybody, because
 * every read resolves through the post row that has just stopped naming it.
 */
export async function discardPostPhoto(storagePath: string) {
  await removeUploadedImage(BUSINESS_PHOTO_BUCKET, storagePath);
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

/**
 * The three replies an owner writes once.
 *
 * PRIVATE NOTES, never messages: nothing here is delivered to anybody. The
 * owner taps one into their composer, reads it, edits it if they want, and
 * presses send, at which point it becomes an ordinary message on the ordinary
 * path. That is why they are their own table rather than a column on
 * `businesses`, whose select grant reaches anon - a traveler must never be
 * able to read the script the other side is answering from
 * (20260902180000_three_replies_written_once.sql).
 */
export type SavedReply = { id: string; position: number; body: string };

export async function fetchSavedReplies(businessId: string): Promise<SavedReply[]> {
  const { data, error } = await supabase
    .from('business_saved_replies')
    .select('id, position, body')
    .eq('business_id', businessId)
    .order('position');
  if (error) {
    throw error;
  }
  return (data ?? []) as SavedReply[];
}

/**
 * Write one slot, or clear it.
 *
 * Upsert on (business_id, position), which is the table's own unique
 * constraint, so editing slot 1 twice cannot leave two rows in it. An empty
 * body deletes rather than storing a blank: a chip with nothing on it is a
 * control that does nothing, and the check constraint refuses length 0
 * anyway.
 */
export async function setSavedReply(
  businessId: string,
  position: number,
  body: string
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) {
    const { error } = await supabase
      .from('business_saved_replies')
      .delete()
      .eq('business_id', businessId)
      .eq('position', position);
    if (error) {
      throw error;
    }
    return;
  }
  const { error } = await supabase
    .from('business_saved_replies')
    .upsert(
      { business_id: businessId, position, body: trimmed },
      { onConflict: 'business_id,position' }
    );
  if (error) {
    throw error;
  }
}
