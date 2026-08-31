// Hand-maintained TypeScript mirror of supabase/migrations/*.sql.
// Regenerate with `supabase gen types typescript` once a hosted project is
// linked; until then, keep this in lockstep with the migrations (the pgTAP
// suite is the source of truth for behavior).

export type UserStatus = 'active' | 'suspended' | 'banned' | 'shadowbanned';
export type Gender = 'woman' | 'man' | 'nonbinary' | 'unspecified';
/** Who a traveler is shown to on the map and in Travelers. Chat ignores it. */
export type ProfileAudience =
  'everyone' | 'verified' | 'verified_men' | 'verified_women' | 'verified_nonbinary';
export type ModerationStatus = 'pending' | 'approved' | 'rejected';
export type SocialPlatform =
  'instagram' | 'tiktok' | 'snapchat' | 'x' | 'facebook' | 'whatsapp' | 'telegram' | 'other';
export type ChatStatus = 'active' | 'closed';

// Mirrors the client-readable column grant — the `verification` evidence
// jsonb exists in the table but has no SELECT grant, so it never appears here
// and clients must always select explicit columns (see PROFILE_COLUMNS).
export type ProfileRow = {
  user_id: string;
  display_name: string | null;
  age: number | null;
  home_city: string | null;
  home_country: string | null;
  languages: string[];
  bio: string | null;
  /** Optional one-liner: what you do, or what you study. */
  occupation: string | null;
  gender: Gender;
  verified: boolean;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const PROFILE_COLUMNS =
  'user_id, display_name, age, home_city, home_country, languages, bio, occupation, gender, verified, onboarding_completed_at, created_at, updated_at';

// Columns the client is actually allowed to update (see the column-level
// GRANT in the core migration) — verified/verification are server-owned.
export type ProfileUpdate = Partial<
  Pick<
    ProfileRow,
    | 'display_name'
    | 'age'
    | 'home_city'
    | 'home_country'
    | 'languages'
    | 'bio'
    | 'occupation'
    | 'gender'
    | 'onboarding_completed_at'
  >
>;

export type ProfilePhotoRow = {
  id: string;
  user_id: string;
  storage_path: string;
  position: number;
  moderation_status: ModerationStatus;
  moderation_attempts: number;
  /**
   * Why a rejected photo was rejected, and which engine decided. Both null
   * until a verdict lands, and both null on an approved photo: only the
   * rejection branch of apply_photo_verdict writes them. `moderation_engine`
   * is 'failsafe' when the check gave up, which is NOT a rules breach - see
   * src/constants/moderation.ts.
   */
  moderation_category: string | null;
  moderation_engine: string | null;
  created_at: string;
};

export type SocialHandleRow = {
  id: string;
  user_id: string;
  platform: SocialPlatform;
  handle: string;
  created_at: string;
};

export type TripStatus = 'active' | 'cancelled';
export type RequestSource = 'trip_match' | 'pin';

export type CityRow = {
  id: number;
  name: string;
  country_code: string;
  country_name: string;
  admin: string | null;
  lat: number;
  lng: number;
  population: number;
};

export type TripRow = {
  id: string;
  user_id: string;
  city_id: number;
  start_date: string;
  end_date: string;
  status: TripStatus;
  created_at: string;
  updated_at: string;
};

/**
 * 'business' is a traveler writing to a place. Added by
 * 20260827090000_business_enums.sql and never added here, so every
 * `kind === 'business'` branch in the client was typed as unreachable and
 * quietly deleted by the compiler's narrowing.
 */
export type ChatKind = 'direct' | 'room' | 'business';

/** Row shape returned by the get_matches() RPC. */
export type MatchRow = {
  trip_id: string;
  user_id: string;
  display_name: string | null;
  age: number | null;
  verified: boolean;
  languages: string[];
  bio: string | null;
  occupation: string | null;
  gender: Gender;
  city_id: number;
  city_name: string;
  city_country: string;
  overlap_start: string;
  overlap_end: string;
  /** The counterpart's whole stay, so a card can show its length. */
  their_start: string;
  their_end: string;
  photo_path: string | null;
};

/** traveler_trips() — every upcoming trip on someone's profile. */
export type TravelerTripRow = {
  trip_id: string;
  city_id: number;
  city_name: string;
  city_country: string;
  start_date: string;
  end_date: string;
};

/** featured_traveler() — the one card a signed-out visitor sees. */
export type FeaturedTravelerRow = {
  user_id: string;
  display_name: string | null;
  age: number | null;
  verified: boolean;
  languages: string[];
  bio: string | null;
  city_name: string;
  their_start: string;
  their_end: string;
  photo_path: string | null;
};

/** public_city_pins() — deliberately has no identity columns. */
export type PublicPinRow = {
  id: string;
  venue_name: string;
  note: string | null;
  /** What the person is doing there ("Sunset drinks"); the venue is the spot. */
  plan: string | null;
  place_label: string | null;
  category: PinCategory;
  lat: number;
  lng: number;
  intent_date: string;
  seeded: boolean;
  seed_note: string | null;
  expires_at: string;
  /** Set when the pin is open to join. Guests see that a plan is open too. */
  chat_id: string | null;
  crew: number;
};

/**
 * Every kind of place that can be on the map. Mirrors the
 * `public.business_category` enum; the two must move together.
 */
export type BusinessCategory =
  | 'hostel'
  | 'hotel'
  | 'guesthouse'
  | 'bar'
  | 'restaurant'
  | 'cafe'
  | 'club'
  | 'tour'
  | 'activity'
  | 'coworking'
  | 'wellness'
  | 'shop'
  | 'other';

/**
 * One business, as far as the column-scoped grant lets a client read it.
 *
 * `owner_user_id`, `state` and the raw `verified_at` are deliberately absent:
 * there is no SELECT grant on them, so naming one in a query is a permission
 * error rather than a null. `verified` is a generated boolean that exists so
 * the badge can render without the timestamp ever reaching a client.
 */
export type BusinessRow = {
  id: string;
  city_id: number;
  name: string;
  category: BusinessCategory;
  description: string | null;
  /** The street address, as the business typed or picked it. */
  address: string | null;
  /** The finding-the-door note. Not the address, and not derived from it. */
  place_label: string | null;
  hours_note: string | null;
  website_url: string | null;
  lat: number;
  lng: number;
  chat_id: string | null;
  public_preview: boolean;
  active: boolean;
  verified: boolean;
};

/** Where a listing stands. Mirrors `public.business_state`. */
export type BusinessState = 'unconfirmed' | 'listed' | 'flagged' | 'removed';

/**
 * my_business() — the caller's own listing, with the two fields no other
 * client may read. `state` is here and nowhere else: the owner's dashboard
 * has to be able to say "Waiting on your email", and the same column is
 * hidden from everybody else because it would leak the moderation queue.
 */
export type MyBusinessRow = BusinessRow & {
  state: BusinessState;
};

/** business_link_kind. What a link is FOR, which decides its icon and its label. */
export type BusinessLinkKind =
  | 'website'
  | 'reservations'
  | 'tickets'
  | 'menu'
  | 'phone'
  | 'email'
  | 'whatsapp'
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'x'
  | 'other';

/** city_businesses() — one marker on the map. */
export type CityBusinessRow = {
  id: string;
  chat_id: string | null;
  name: string;
  category: BusinessCategory;
  lat: number;
  lng: number;
  verified: boolean;
  cover_path: string | null;
  /** Something on tonight. Earns a brighter ring, never a bigger marker. */
  has_live_post: boolean;
  member_count: number;
};

export type BusinessPhotoJson = { id: string; storage_path: string };
export type BusinessLinkJson = {
  id: string;
  kind: BusinessLinkKind;
  label: string;
  value: string;
};
/** `opens`/`closes` are 'HH:MM:SS'. closes < opens means past midnight. */
export type BusinessHourJson = { weekday: number; opens: string; closes: string };
export type BusinessPostJson = {
  id: string;
  title: string;
  body: string | null;
  photo_path: string | null;
  happens_at: string | null;
  ends_at: string | null;
};

/** business_detail() — one place's whole page, in one round trip. */
export type BusinessDetailRow = {
  id: string;
  chat_id: string | null;
  city_id: number;
  name: string;
  category: BusinessCategory;
  description: string | null;
  /** The finding-the-door note: "blue door, two minutes from the station". */
  place_label: string | null;
  /** The street address, as the business typed or picked it. */
  address: string | null;
  hours_note: string | null;
  website_url: string | null;
  lat: number;
  lng: number;
  verified: boolean;
  /**
   * Whether anybody runs this place here.
   *
   * False for the launch venues nobody has claimed yet. `message_business`
   * refuses those outright, so a screen that offers Message without checking
   * this sends somebody to type five hundred characters into a refusal.
   */
  claimed: boolean;
  member_count: number;
  photos: BusinessPhotoJson[];
  links: BusinessLinkJson[];
  hours: BusinessHourJson[];
  posts: BusinessPostJson[];
};

export type BusinessVerificationStatus = 'pending' | 'approved' | 'rejected' | 'uncertain';

/** The columns the owner is granted. `verdict` and the paths are not among them. */
export const BUSINESS_VERIFICATION_COLUMNS =
  'id, business_id, status, reason, created_at, reviewed_at';

export type BusinessVerificationRow = {
  id: string;
  business_id: string;
  status: BusinessVerificationStatus;
  reason: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type BusinessReportReason =
  | 'not_a_real_place'
  | 'permanently_closed'
  | 'not_this_business'
  | 'wrong_location'
  | 'spam_or_offensive';

export type RatingBucket = 'not_for_me' | 'fine' | 'loved';

export type RatingTag =
  | 'good_for_meeting_people'
  | 'cheap'
  | 'quiet'
  | 'lively'
  | 'late'
  | 'good_coffee'
  | 'worth_the_trip';

/** my_ratings() — the caller's own ranked list, which the comparisons walk. */
export type MyRatingRow = {
  business_id: string;
  name: string;
  bucket: RatingBucket;
  score: number;
};

/**
 * business_rating_summary() — `average` and `top_tags` are NULL below five
 * raters, and that is the server's decision rather than the client's.
 */
export type RatingSummaryRow = {
  average: number | null;
  rater_count: number;
  top_tags: RatingTag[] | null;
};

/** top_rated_by() — somebody's best places, for the shelf on their profile. */
export type TopRatedRow = {
  business_id: string;
  name: string;
  category: BusinessCategory;
  score: number;
};

/**
 * city_rooms() — business rooms in a city.
 *
 * `kind` is the category as text. The RPC keeps its old name and its old
 * column order because iOS builds already in the field call it by name over
 * the wire, and a binary does not update over the air.
 */
export type CityRoomRow = {
  chat_id: string;
  business_id: string;
  name: string;
  kind: BusinessCategory;
  lat: number;
  lng: number;
  member_count: number;
  last_message_at: string | null;
  public_preview: boolean;
};

/** room_messages() — readable by members, moderators, and public previews. */
export type RoomMessageRow = {
  id: string;
  sender_id: string;
  display_name: string | null;
  photo_path: string | null;
  body: string | null;
  image_path: string | null;
  removed: boolean;
  /**
   * Withdrawn, and when. The RPC predated unsend and did not return this, so
   * a message unsent in a group came back with a null body, `removed = false`
   * and no flag — and the thread drew an empty bubble under the sender's name,
   * for everyone, forever.
   */
  unsent_at: string | null;
  created_at: string;
  /**
   * What this message answers, joined by room_messages. The name is the
   * parent sender's display name and never a handle (hard rule 4), and the
   * body comes back null once the parent is unsent or removed rather than
   * preserving a copy of something the reader may no longer be shown.
   */
  reply_to_message_id: string | null;
  reply_to_name: string | null;
  reply_to_body: string | null;
  /**
   * Whether there is a photo here and where it has got to.
   *
   * `image_path` above is masked until a verdict lands, which is right — but
   * masking was all the RPC did, so a photo in review arrived as a row with
   * no image and no flag, and the thread drew an empty bubble for the whole
   * wait. 'checking' is what the review tile is drawn from.
   */
  photo_state: 'none' | 'ready' | 'checking' | 'blocked';
  /**
   * 'said' is a person talking; 'joined' is the room recording an arrival
   * ("Ana is in"), written by join_pin_chat. The thread renders the second
   * as a centred line, never as a bubble somebody appears to have typed.
   */
  kind: 'said' | 'joined';
};

export type ReactionSummaryRow = {
  message_id: string;
  emoji: string;
  count: number;
  reacted_by_me: boolean;
};

/**
 * Row shape returned by support_message_status(). Deliberately carries no body
 * and no address: it answers "what became of mine", not "show me the inbox".
 */
export type SupportMessageStatusRow = {
  created_at: string;
  delivered_at: string | null;
  attempts: number;
};

/**
 * Row shape returned by incoming_requests().
 *
 * The three overlap columns are the shared city and the shared dates, and
 * they are nullable for a reason: incoming_requests() is SECURITY INVOKER,
 * so the sender's trips are read under the recipient's own
 * trips_select_overlap policy. A hello that came from a pin rather than a
 * trip match has no readable overlap and returns three nulls, which is the
 * correct answer and not a gap.
 */
export type IncomingRequestRow = {
  id: string;
  sender_id: string;
  display_name: string | null;
  age: number | null;
  verified: boolean;
  profile_element: string | null;
  first_message: string;
  photo_path: string | null;
  created_at: string;
  overlap_city: string | null;
  overlap_start: string | null;
  overlap_end: string | null;
};

/**
 * Row shape returned by sent_requests(). `state` deliberately collapses
 * pending, declined and expired into 'sent' — the DB never tells a sender
 * they were declined (invariant 4), and expiry is carried by `expired_at`
 * rather than by a sixth state.
 *
 * That split is not cosmetic. An over-the-air update is never applied on the
 * launch that downloads it, so for at least one launch every phone runs the
 * PREVIOUS bundle against the new schema: a state it has never heard of
 * would drop the sender's own hello out of "You said hi" and, worse, make
 * `saidHiAlready` answer "nothing is out to this traveler" and offer a
 * second Say hi the unique constraint refuses. So `state` keeps its
 * vocabulary and the new fact arrives as an extra nullable column, the same
 * way the push payload's `kind` key did.
 *
 * `expired_at` is null unless the nightly sweep ended the row. It leaks
 * nothing: the sweep stamps the unanswered rows and the declined ones in one
 * statement, on a clock read off the SENDER's own trip dates.
 */
export type SentRequestRow = {
  id: string;
  recipient_id: string;
  source: RequestSource;
  profile_element: string | null;
  first_message: string;
  state: 'sent' | 'accepted' | 'blocked';
  chat_id: string | null;
  created_at: string;
  /** When the sweep ended this hello; null while it is still answerable. */
  expired_at: string | null;
};

/** Row shape returned by my_chats(), pinned first then by last activity. */
export type ChatListRow = {
  chat_id: string;
  kind: ChatKind;
  chat_status: ChatStatus;
  /** Business name for rooms, the other person's name for direct chats. */
  title: string | null;
  other_user_id: string | null;
  photo_path: string | null;
  first_message: string | null;
  first_message_sender_id: string | null;
  last_message: string | null;
  last_message_at: string | null;
  member_count: number | null;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  /** When this user's room membership lapses (rooms only). */
  expires_at: string | null;
  created_at: string;
  /** Traveler groups only: 'admin' | 'speaker' | 'member'. Null elsewhere. */
  my_role: GroupRole | null;
  /**
   * Messages somebody else sent since this user last opened the chat. Counts
   * only what a human wrote and what has cleared moderation, so a badge
   * built on it can only ever mean "somebody is waiting for you".
   */
  unread_count: number;
  /**
   * What the first message was a reply TO — 'trip', 'bio', 'photo:0',
   * 'languages', 'home', or 'pin:<venue>'. The context the recipient had
   * when they decided to accept, so the chat does not open on a sentence
   * with no subject.
   */
  first_message_element: string | null;
};

/** One answered prompt on a profile (features/profile/prompts.ts). */
export type ProfilePromptRow = {
  user_id: string;
  slot: number;
  prompt_key: string;
  answer: string;
  updated_at: string;
};

/**
 * One line on the Top priorities list (features/profile/priorities.ts).
 * `slot` is 0-5 and is what orders the list; six is enforced by the primary
 * key rather than by anything here.
 */
export type ProfilePriorityRow = {
  user_id: string;
  slot: number;
  text: string;
  updated_at: string;
};

export type GroupRole = 'admin' | 'speaker' | 'member';

export type GroupSpeaking = 'everyone' | 'granted';

/**
 * Who may hand out a group's invite link. Defaults to 'everyone', including
 * for groups that existed before the column did: nobody chose admin-only
 * under the old rule, because the app never offered the choice.
 */
export type GroupInvitesWho = 'everyone' | 'admin';

/**
 * Who may put you in a group. 'known' is anybody you have chatted with, the
 * rule add_to_group has always enforced; 'link_only' is nobody, and you join
 * by opening a link instead. Never readable as a column: my_group_adds and
 * set_group_adds are the whole client surface.
 */
export type GroupAddPolicy = 'known' | 'link_only';

export type GroupRow = {
  chat_id: string;
  created_by: string | null;
  name: string;
  photo_path: string | null;
  speaking: GroupSpeaking;
  /**
   * Who may mint the invite link. Turning a live link off stays the admin's,
   * whatever this says (revoke_group_invites is moderator-only).
   */
  invites: GroupInvitesWho;
  /**
   * The last day this chat is active; it closes the day after. NULL means no
   * end date, and the chat never closes.
   *
   * Widened deliberately, and it is load-bearing rather than ceremonial:
   * every reader of this field goes through parseISODate, which does
   * `iso.split('-')` and throws on null. Typing it honestly is what makes
   * every one of those call sites findable by the compiler instead of by a
   * white screen.
   */
  max_stay_until: string | null;
  /**
   * The pin this group opened from, while that pin is alive. Goes null when
   * the pin expires or is taken down (ON DELETE SET NULL); the group
   * survives that as an ordinary no-end-date group. On the wire since
   * 20260829120000 — fetchGroup does `select('*')` — only the type was
   * missing. Non-null is what tells the room to ask pin_for_group.
   */
  pin_id: string | null;
  /**
   * Stamped by the pins delete trigger the moment the plan's pin leaves the
   * table, because expire_pins hard-deletes and ON DELETE SET NULL erases
   * pin_id — this is what keeps the room's "burned out" line honest after
   * the sweep. Null for groups that never had a pin or predate the stamp.
   */
  plan_ended_at: string | null;
  created_at: string;
};

export type GroupMemberRow = {
  user_id: string;
  display_name: string | null;
  photo_path: string | null;
  role: GroupRole;
  /** NULL for the admin of a group with no end date: they never leave. */
  departure_date: string | null;
  joined_at: string;
};

export type GroupInvitePreviewRow = {
  chat_id: string;
  name: string;
  photo_path: string | null;
  member_count: number;
  max_stay_until: string | null;
  speaking: GroupSpeaking;
  already_member: boolean;
  /**
   * The chat has ended, or its link was withdrawn. The row comes back either
   * way now, so a group that ran its course is not described to a stranger as
   * a link somebody turned off.
   */
  closed: boolean;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string | null;
  image_path: string | null;
  /** Set when the SENDER took the message back. Distinct from moderator removal. */
  unsent_at?: string | null;
  /**
   * Set when the message was taken down by somebody other than its sender —
   * in a one-to-one chat, that means a photo the classifier refused, which
   * also empties `image_path`. Without it the thread drew an empty bubble
   * where the photo had been, for both people, forever.
   */
  removed_at?: string | null;
  created_at: string;
  /**
   * What this message answers, or null for an ordinary one. Direct chats read
   * `messages` with `select *`, so it arrives free; the quoted line itself is
   * resolved from the loaded page (features/chat/reply.ts).
   */
  reply_to_message_id?: string | null;
  /**
   * Where a photo on this message has got to. Present because direct chats
   * read `messages` with `select *`; a room reads the RPC instead and maps
   * its own `photo_state` onto this, so the thread has one question to ask.
   *
   * The storage read policy is the actual control — it refuses anybody but
   * the sender until 'approved' — so this is for drawing the review tile,
   * never for deciding who may see a picture.
   */
  moderation_status?: 'pending' | 'approved' | 'rejected';
  /**
   * 'said' is a person talking; 'joined' is a room recording an arrival.
   * Optional because direct chats read the table with `select *` and never
   * carry a 'joined' row today — the column arrives whether or not a cached
   * row was fetched before the migration added it.
   */
  kind?: 'said' | 'joined';
};

/**
 * Mirrors public.report_reason, including the two values added after the
 * enum was first created: 'impersonation' (20260827090000) and 'underage'
 * (20260831200000). Both are listed here even though the report form offers
 * only one of them, because src/app/__tests__/report-reasons.test.ts asserts
 * every value is either offered or explicitly declined with a reason. The
 * silent drift this fixes is real: 'impersonation' sat in the database for
 * a month, absent from this union and from the form.
 */
export type ReportReason =
  | 'flirtation_or_sexual'
  | 'harassment'
  | 'spam'
  | 'fake_profile'
  | 'safety_concern'
  | 'impersonation'
  | 'underage'
  | 'immediate_danger'
  | 'other';

export type SendRequestResult = {
  /**
   * Null on the capped branch, where nothing was written. Every branch of
   * send_message_request returns the same KEYS so this one type is true of
   * all of them; what varies is the values.
   */
  request_id: string | null;
  delivered: boolean;
  /**
   * True when the message cleared the pre-filter but is held for LLM
   * moderation (Phase 5). The UI treats queued like delivered — the recipient
   * simply gets it a little later if it passes.
   */
  queued: boolean;
  blocked: boolean;
  /**
   * You have already sent today's allowance of first messages. Not an error
   * and not a paywall: a safety limit that paces senders and keeps the
   * moderation queue readable (hard rule 1 — never sold back).
   */
  capped: boolean;
  /** How many hellos a day this account gets. */
  allowed: number;
  /** How many of them are spent, including this one. */
  used: number;
  /**
   * Which kind of wrong the prefilter named ('sexual', 'flirtation').
   * Null on every branch except blocked — it exists so the refusal can say
   * what actually went wrong, and it never names the matched phrase.
   */
  category: string | null;
};

/**
 * The routing payload every push the database sends carries in `data`. The
 * union is what lets the tap-routing switch be exhaustive rather than
 * stringly typed — and old builds sent payloads with none of these keys, so
 * every consumer must tolerate an empty object too.
 */
export type PushPayload =
  | {
      type: 'message';
      chat_id: string;
      /**
       * Which screen a chat opens on: 'room' is /room/[id], everything else
       * is /chat/[id]. Optional because pushes queued by older function
       * definitions carry no kind.
       */
      kind?: 'direct' | 'room';
    }
  | { type: 'accepted'; chat_id: string }
  | { type: 'request' }
  | { type: 'moderation' }
  | { type: 'verification' }
  | { type: 'support' }
  /**
   * An urgent report (underage or immediate danger), raised to whoever is on
   * support duty by log_report — see
   * 20260901120100_an_urgent_report_wakes_somebody.sql.
   *
   * routeForPayload returns null for this one ON PURPOSE, and that is why it
   * is written here rather than left to fall through the default: there is no
   * in-app review queue to open. The reviewer works in the dashboard
   * (docs/DASHBOARD.md), so the tap opens the app rather than dropping
   * somebody on a screen that cannot help. `report_id` is carried for the
   * reviewer's own copy-paste, not for routing.
   */
  | { type: 'report'; report_id: string };

export type VerificationStatus = 'pending' | 'approved' | 'rejected';

/**
 * Client-readable slice of verification_requests — the raw model verdict and
 * attempts counter have no SELECT grant.
 */
export type VerificationRequestRow = {
  id: string;
  user_id: string;
  status: VerificationStatus;
  reason: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export const VERIFICATION_REQUEST_COLUMNS = 'id, user_id, status, reason, created_at, reviewed_at';

export type PinCategory =
  'bar' | 'restaurant' | 'club' | 'museum' | 'monument' | 'beach' | 'hike' | 'other';

export type LaunchCityRow = {
  city_id: number;
  active: boolean;
  radius_km: number;
  heat_k: number;
  created_at: string;
};

/** Row shape returned by city_pins(). Seeded pins have user_id = null. */
export type CityPinRow = {
  id: string;
  user_id: string | null;
  display_name: string | null;
  age: number | null;
  verified: boolean;
  photo_path: string | null;
  venue_name: string;
  /** The finding-the-door detail, in the author's words. */
  note: string | null;
  /** What the person is doing there ("Sunset drinks"); the venue is the spot. */
  plan: string | null;
  /** Street or area the pin sits on, as the author confirmed it. */
  place_label: string | null;
  category: PinCategory;
  lat: number;
  lng: number;
  intent_date: string;
  seeded: boolean;
  seed_note: string | null;
  expires_at: string;
  /**
   * The group chat this pin opened with, when its author ticked "anyone can
   * join". Null on a message-me-first pin and on every curated one, which is
   * exactly the test for "is this joinable".
   */
  chat_id: string | null;
  /** How many are in that chat, counting the author. Zero when there is none. */
  crew: number;
};

/**
 * Row shape returned by pin_for_group(): the plan a pin-born group came
 * from, for the room's own card. Members only, and empty once the pin has
 * expired (hard rule 3) or been taken down.
 */
export type PinForGroupRow = {
  pin_id: string;
  venue_name: string;
  place_label: string | null;
  category: PinCategory;
  intent_date: string;
  expires_at: string;
  lat: number;
  lng: number;
};

/** Row shape returned by pin_crew(): who is already going. */
export type PinCrewRow = {
  user_id: string;
  display_name: string | null;
  photo_path: string | null;
  is_owner: boolean;
  joined_at: string;
};

/** Row shape returned by people_you_know(): the address book, finally. */
export type KnownPersonRow = {
  user_id: string;
  display_name: string | null;
  photo_path: string | null;
  verified: boolean;
  /** You two have a one-to-one chat. */
  chatted: boolean;
  /** You two are in a group together. */
  in_a_group: boolean;
};

/**
 * Row shape returned by daily_spotlight() — the one traveler surfaced to
 * BOTH of you today. Empty when there is nobody left to pair with.
 */
export type SpotlightRow = {
  user_id: string;
  display_name: string | null;
  age: number | null;
  verified: boolean;
  languages: string[];
  bio: string | null;
  occupation: string | null;
  city_name: string;
  overlap_start: string;
  overlap_end: string;
  photo_path: string | null;
};

/** Row shape returned by room_pins(): what a host has kept at the top. */
export type PinnedMessageRow = {
  message_id: string;
  body: string | null;
  image_path: string | null;
  sender_id: string;
  display_name: string | null;
  expires_at: string;
};

/** Row shape returned by room_info(): what a room is called, before you join. */
export type RoomInfoRow = {
  chat_id: string;
  name: string | null;
  kind: string;
  member_count: number;
  public_preview: boolean;
  is_group: boolean;
};

/** Row shape returned by heat_cells() — deliberately identifier-free. */
export type HeatCellRow = {
  cell_lat: number;
  cell_lng: number;
  /**
   * People planning something in this ~550m square, counted across every
   * category. It used to be counted per category, which is why heat has
   * never appeared: three people had to be planning the same KIND of thing
   * on the same corner before the k-threshold let the cell through.
   */
  pin_count: number;
};

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          status: UserStatus;
          suspended_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: never;
        Update: ProfileUpdate;
        Relationships: [];
      };
      profile_prompts: {
        Row: ProfilePromptRow;
        Insert: {
          user_id: string;
          slot: number;
          prompt_key: string;
          answer: string;
        };
        Update: Pick<ProfilePromptRow, 'prompt_key' | 'answer'>;
        Relationships: [];
      };
      businesses: {
        Row: BusinessRow;
        // Never inserted from a client: register_business() owns that path,
        // because it writes owner_user_id, city_id and the marker.
        Insert: never;
        Update: Partial<
          Pick<
            BusinessRow,
            | 'name'
            | 'description'
            | 'address'
            | 'place_label'
            | 'hours_note'
            | 'website_url'
            | 'public_preview'
          >
        >;
        Relationships: [];
      };
      business_photos: {
        Row: {
          id: string;
          business_id: string;
          storage_path: string;
          position: number;
          moderation_status: 'pending' | 'approved' | 'rejected';
          moderation_category: string | null;
          moderation_engine: string | null;
          created_at: string;
        };
        Insert: { business_id: string; storage_path: string; position: number };
        Update: { position?: number };
        Relationships: [];
      };
      business_links: {
        Row: {
          id: string;
          business_id: string;
          kind: BusinessLinkKind;
          label: string;
          value: string;
          position: number;
          created_at: string;
        };
        Insert: {
          business_id: string;
          kind: BusinessLinkKind;
          label: string;
          value: string;
          position?: number;
        };
        Update: {
          kind?: BusinessLinkKind;
          label?: string;
          value?: string;
          position?: number;
        };
        Relationships: [];
      };
      business_hours: {
        Row: {
          id: string;
          business_id: string;
          weekday: number;
          opens: string;
          closes: string;
          position: number;
        };
        Insert: {
          business_id: string;
          weekday: number;
          opens: string;
          closes: string;
          position?: number;
        };
        Update: { weekday?: number; opens?: string; closes?: string; position?: number };
        Relationships: [];
      };
      business_posts: {
        Row: {
          id: string;
          business_id: string;
          title: string;
          body: string | null;
          photo_path: string | null;
          happens_at: string | null;
          ends_at: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          title: string;
          body?: string | null;
          photo_path?: string | null;
          happens_at?: string | null;
          ends_at?: string | null;
        };
        Update: {
          title?: string;
          body?: string | null;
          happens_at?: string | null;
          ends_at?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      business_verifications: {
        Row: BusinessVerificationRow;
        // submit_business_verification owns this path: it checks both objects
        // exist in storage before it opens a row.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      profile_priorities: {
        Row: ProfilePriorityRow;
        Insert: {
          user_id: string;
          slot: number;
          text: string;
        };
        Update: Pick<ProfilePriorityRow, 'slot' | 'text'>;
        Relationships: [];
      };
      profile_photos: {
        Row: ProfilePhotoRow;
        Insert: {
          user_id: string;
          storage_path: string;
          position: number;
        };
        Update: Pick<ProfilePhotoRow, 'position'>;
        Relationships: [];
      };
      social_handles: {
        Row: SocialHandleRow;
        Insert: {
          user_id: string;
          platform: SocialPlatform;
          handle: string;
        };
        Update: {
          platform?: SocialPlatform;
          handle?: string;
        };
        Relationships: [];
      };
      chats: {
        Row: {
          id: string;
          status: ChatStatus;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      chat_participants: {
        Row: {
          chat_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      cities: {
        Row: CityRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      trips: {
        Row: TripRow;
        Insert: {
          user_id: string;
          city_id: number;
          start_date: string;
          end_date: string;
        };
        Update: Partial<Pick<TripRow, 'city_id' | 'start_date' | 'end_date' | 'status'>>;
        Relationships: [];
      };
      blocks: {
        Row: {
          blocker_id: string;
          blocked_id: string;
          created_at: string;
        };
        Insert: {
          blocker_id: string;
          blocked_id: string;
        };
        Update: never;
        Relationships: [];
      };
      launch_cities: {
        Row: LaunchCityRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      messages: {
        Row: MessageRow;
        // A message carries text, a photo, or both.
        Insert: {
          chat_id: string;
          sender_id: string;
          body?: string;
          image_path?: string;
          /**
           * What this message answers. The database refuses a parent from
           * another chat (messages_reply_same_chat), so this is a door.
           */
          reply_to_message_id?: string;
        };
        Update: never;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          /**
           * Null where the subject is the chat itself. A report needs a
           * subject and does not need a person: `reports_has_a_subject`
           * refuses one with neither.
           */
          reported_user_id: string | null;
          /** The chat this is about, for a room that has gone bad. */
          reported_chat_id: string | null;
          reason: ReportReason;
          details: string | null;
          context: string | null;
          created_at: string;
        };
        Insert: {
          reporter_id: string;
          reported_user_id?: string | null;
          reported_chat_id?: string | null;
          reason: ReportReason;
          details?: string | null;
          context?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      groups: {
        Row: GroupRow;
        // Every write goes through create_group / update_group.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      support_messages: {
        Row: {
          id: string;
          user_id: string | null;
          reply_to: string;
          body: string;
          created_at: string;
          delivered_at: string | null;
          delivery_attempts: number;
          delivery_error: string | null;
        };
        Insert: {
          user_id?: string | null;
          reply_to: string;
          body: string;
        };
        // Delivery bookkeeping belongs to the mailer, which runs as the
        // service role. There is no client update path at all.
        Update: never;
        Relationships: [];
      };
      push_tokens: {
        Row: {
          token: string;
          user_id: string;
          platform: string;
          updated_at: string;
        };
        Insert: never; // via register_push_token RPC
        Update: never;
        Relationships: [];
      };
      pins: {
        Row: {
          id: string;
          user_id: string | null;
          city_id: number;
          venue_name: string;
          note: string | null;
          plan: string | null;
          place_label: string | null;
          category: PinCategory;
          lat: number;
          lng: number;
          intent_date: string;
          seeded: boolean;
          seed_note: string | null;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          user_id: string;
          city_id: number;
          venue_name: string;
          note?: string | null;
          plan?: string | null;
          place_label?: string | null;
          category: PinCategory;
          lat: number;
          lng: number;
          intent_date: string;
          expires_at: string;
        };
        Update: never;
        Relationships: [];
      };
      message_reactions: {
        Row: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          message_id: string;
          user_id: string;
          emoji: string;
        };
        Update: never;
        Relationships: [];
      };
      verification_requests: {
        // Insert goes through submit_verification(); verdicts are server-side.
        Row: VerificationRequestRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      message_requests: {
        // Recipient-side view (senders read via sent_requests()); the
        // moderation_verdict column has no client grant — select explicit
        // columns only.
        Row: {
          id: string;
          sender_id: string;
          recipient_id: string;
          source: RequestSource;
          profile_element: string | null;
          first_message: string;
          status: 'pending' | 'accepted';
          chat_id: string | null;
          created_at: string;
          responded_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // Caller-scoped: answers only about the calling user's relationships.
      has_accepted_chat: {
        Args: { owner_id: string };
        Returns: boolean;
      };
      search_cities: {
        Args: { p_query: string };
        Returns: CityRow[];
      };
      get_matches: {
        Args: Record<string, never>;
        Returns: MatchRow[];
      };
      traveler_trips: {
        Args: { p_user_id: string };
        Returns: TravelerTripRow[];
      };
      send_message_request: {
        Args: {
          p_recipient: string;
          p_source: RequestSource;
          p_first_message: string;
          p_profile_element?: string | null;
        };
        Returns: SendRequestResult;
      };
      respond_to_message_request: {
        Args: { p_request_id: string; p_accept: boolean };
        Returns: { accepted: boolean; chat_id?: string };
      };
      sent_requests: {
        Args: Record<string, never>;
        Returns: SentRequestRow[];
      };
      incoming_requests: {
        Args: Record<string, never>;
        Returns: IncomingRequestRow[];
      };
      my_chats: {
        Args: { p_archived?: boolean };
        Returns: ChatListRow[];
      };
      mark_chat_read: {
        Args: { p_chat_id: string };
        Returns: string;
      };
      preview_first_message: {
        Args: { p_text: string };
        Returns: { would_block: boolean; category: string | null }[];
      };
      first_message_budget: {
        Args: Record<string, never>;
        Returns: { used: number; allowed: number }[];
      };
      room_pins: {
        Args: { p_chat_id: string };
        Returns: PinnedMessageRow[];
      };
      pin_message: {
        Args: { p_message_id: string; p_hours?: number };
        Returns: undefined;
      };
      unpin_message: {
        Args: { p_message_id: string };
        Returns: undefined;
      };
      room_info: {
        Args: { p_chat_id: string };
        Returns: RoomInfoRow[];
      };
      register_business: {
        Args: {
          p_name: string;
          p_category: BusinessCategory;
          p_city_id: number;
          p_lat: number;
          p_lng: number;
          /** As typed or picked; never derived from the marker. */
          p_address?: string | null;
        };
        Returns: string;
      };
      /** lat/lng are withheld from the client's UPDATE grant; this is the door. */
      update_business_location: {
        Args: {
          p_lat: number;
          p_lng: number;
          p_city_id?: number | null;
          p_address?: string | null;
          p_clear_address?: boolean;
        };
        Returns: undefined;
      };
      is_business_account: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      my_business: {
        Args: Record<string, never>;
        Returns: MyBusinessRow[];
      };
      city_businesses: {
        Args: { p_city_id: number };
        Returns: CityBusinessRow[];
      };
      business_detail: {
        Args: { p_business_id: string };
        Returns: BusinessDetailRow[];
      };
      request_business_email_confirmation: {
        Args: { p_email: string };
        Returns: undefined;
      };
      confirm_business_email: {
        Args: { p_code: string };
        Returns: { confirmed: boolean; first_time: boolean };
      };
      submit_business_verification: {
        Args: { p_wide_path: string; p_close_path: string };
        Returns: { request_id: string; status: string };
      };
      report_business: {
        Args: {
          p_business_id: string;
          p_reason: BusinessReportReason;
          p_note?: string | null;
        };
        Returns: undefined;
      };
      message_business: {
        Args: { p_business_id: string; p_first_message: string };
        Returns: { chat_id?: string; blocked: boolean; existing?: boolean };
      };
      business_for_chat: {
        Args: { p_chat_id: string };
        Returns: string | null;
      };
      rate_business: {
        Args: {
          p_business_id: string;
          p_bucket: RatingBucket;
          p_rank: number;
          p_tags?: RatingTag[];
        };
        Returns: { score: number };
      };
      my_ratings: {
        Args: { p_category: BusinessCategory };
        Returns: MyRatingRow[];
      };
      business_rating_summary: {
        Args: { p_business_id: string };
        Returns: RatingSummaryRow[];
      };
      top_rated_by: {
        Args: { p_user_id: string; p_city_id?: number | null };
        Returns: TopRatedRow[];
      };
      daily_spotlight: {
        Args: Record<string, never>;
        Returns: SpotlightRow[];
      };
      featured_traveler: {
        Args: { p_city_id: number };
        Returns: FeaturedTravelerRow[];
      };
      public_city_pins: {
        Args: { p_city_id: number };
        Returns: PublicPinRow[];
      };
      public_heat_cells: {
        Args: { p_city_id: number; p_date?: string | null };
        Returns: HeatCellRow[];
      };
      city_rooms: {
        Args: { p_city_id: number };
        Returns: CityRoomRow[];
      };
      room_messages: {
        Args: {
          p_chat_id: string;
          p_limit?: number;
          /**
           * The oldest `created_at` already on screen. A thread is
           * newest-first, so the next page is OLDER, and null is the first
           * page.
           */
          p_before?: string | null;
        };
        Returns: RoomMessageRow[];
      };
      message_reaction_summary: {
        Args: { p_chat_id: string };
        Returns: ReactionSummaryRow[];
      };
      create_group: {
        Args: {
          p_name: string;
          /** Null is a real answer: no end date, the chat never closes. */
          p_max_stay_until: string | null;
          p_speaking?: GroupSpeaking;
          p_photo_path?: string | null;
        };
        Returns: string;
      };
      update_group: {
        Args: {
          p_chat_id: string;
          p_name?: string | null;
          p_speaking?: GroupSpeaking | null;
          /** Null means "leave it alone", the way it always has. */
          p_max_stay_until?: string | null;
          p_photo_path?: string | null;
          p_clear_photo?: boolean;
          /** Turning the end date OFF, since null already means "leave it". */
          p_clear_max_stay?: boolean;
          /** Who may hand out the link. Null leaves it alone. */
          p_invites?: GroupInvitesWho | null;
        };
        Returns: undefined;
      };
      set_group_role: {
        Args: { p_chat_id: string; p_user_id: string; p_role: 'member' | 'speaker' };
        Returns: undefined;
      };
      group_members: {
        Args: { p_chat_id: string };
        Returns: GroupMemberRow[];
      };
      group_invite_token: {
        Args: { p_chat_id: string };
        Returns: string;
      };
      revoke_group_invites: {
        Args: { p_chat_id: string };
        Returns: undefined;
      };
      group_invite_preview: {
        Args: { p_token: string };
        Returns: GroupInvitePreviewRow[];
      };
      join_group_with_invite: {
        Args: { p_token: string; p_stay_until: string };
        Returns: { chat_id: string; stay_until: string; expires_at: string };
      };
      set_reaction: {
        Args: { p_message_id: string; p_emoji: string };
        Returns: undefined;
      };
      unsend_message: {
        Args: { p_message_id: string };
        Returns: undefined;
      };
      submit_support_message: {
        // p_category defaults to null in the database, so a build that
        // predates the chip row keeps working through the OTA gap.
        Args: { p_reply_to: string; p_body: string; p_category?: string };
        Returns: string;
      };
      support_message_status: {
        Args: { p_id: string };
        Returns: SupportMessageStatusRow[];
      };
      join_room: {
        Args: { p_chat_id: string; p_departure_date: string };
        Returns: { joined: boolean; expires_at: string };
      };
      leave_room: {
        Args: { p_chat_id: string };
        Returns: undefined;
      };
      set_chat_pref: {
        Args: {
          p_chat_id: string;
          p_pinned?: boolean | null;
          p_muted?: boolean | null;
          p_archived?: boolean | null;
        };
        Returns: undefined;
      };
      room_remove_message: {
        Args: { p_message_id: string };
        Returns: undefined;
      };
      room_remove_member: {
        Args: { p_chat_id: string; p_user_id: string };
        Returns: undefined;
      };
      my_business_code_status: {
        Args: Record<string, never>;
        Returns: {
          sent_at?: string;
          delivered?: boolean;
          attempts?: number;
          failed?: boolean;
        };
      };
      city_pins: {
        Args: { p_city_id: number };
        Returns: CityPinRow[];
      };
      post_joinable_pin: {
        Args: {
          p_city_id: number;
          p_venue_name: string;
          p_note: string | null;
          p_place_label: string | null;
          p_category: PinCategory;
          p_lat: number;
          p_lng: number;
          p_intent_date: string;
          p_expires_at: string;
          p_plan?: string | null;
        };
        Returns: { pin_id: string; chat_id: string };
      };
      join_pin_chat: {
        Args: { p_pin_id: string };
        Returns: { chat_id: string };
      };
      pin_crew: {
        Args: { p_pin_id: string };
        Returns: PinCrewRow[];
      };
      pin_for_group: {
        Args: { p_chat_id: string };
        Returns: PinForGroupRow[];
      };
      people_you_know: {
        Args: { p_query?: string | null };
        Returns: KnownPersonRow[];
      };
      shares_group_with: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      add_to_group: {
        Args: { p_chat_id: string; p_user_id: string };
        Returns: { chat_id: string; user_id: string };
      };
      open_direct_chat: {
        Args: { p_user_id: string; p_first_message: string };
        Returns: { chat_id?: string; blocked: boolean };
      };
      unmatch_chat: {
        Args: { p_chat_id: string };
        Returns: undefined;
      };
      register_push_token: {
        Args: { p_token: string; p_platform?: string };
        Returns: undefined;
      };
      heat_cells: {
        Args: { p_city_id: number; p_date?: string | null };
        Returns: HeatCellRow[];
      };
      submit_verification: {
        Args: { p_storage_path: string };
        Returns: { request_id: string; status: 'pending' };
      };
      set_guest_name: {
        Args: { p_name: string };
        Returns: string;
      };
      my_visibility: {
        Args: Record<string, never>;
        Returns: ProfileAudience;
      };
      my_group_adds: {
        Args: Record<string, never>;
        Returns: GroupAddPolicy;
      };
      set_group_adds: {
        Args: { p_policy: GroupAddPolicy };
        Returns: GroupAddPolicy;
      };
      /** The name of whoever added the caller to this chat, or null. */
      who_added_me: {
        Args: { p_chat_id: string };
        Returns: string | null;
      };
      set_visibility: {
        Args: { p_audience: ProfileAudience };
        Returns: ProfileAudience;
      };
      /**
       * The listing-intent pair. `profiles.wants_business` carries no column
       * grant at all (profiles_select_visible would otherwise publish it to
       * every reader), so these two definer functions are the only door, and
       * neither takes a user id.
       */
      listing_intent: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      set_listing_intent: {
        Args: { p_wants: boolean };
        Returns: boolean;
      };
    };
    Enums: {
      user_status: UserStatus;
      gender: Gender;
      moderation_status: ModerationStatus;
      social_platform: SocialPlatform;
      chat_status: ChatStatus;
      group_invites_who: GroupInvitesWho;
      group_add_policy: GroupAddPolicy;
      trip_status: TripStatus;
      request_source: RequestSource;
      verification_status: VerificationStatus;
      chat_kind: ChatKind;
      profile_audience: ProfileAudience;
    };
    CompositeTypes: Record<string, never>;
  };
};
