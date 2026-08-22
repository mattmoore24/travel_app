// Hand-maintained TypeScript mirror of supabase/migrations/*.sql.
// Regenerate with `supabase gen types typescript` once a hosted project is
// linked; until then, keep this in lockstep with the migrations (the pgTAP
// suite is the source of truth for behavior).

export type UserStatus = 'active' | 'suspended' | 'banned' | 'shadowbanned';
export type Gender = 'woman' | 'man' | 'nonbinary' | 'unspecified';
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

export type ChatKind = 'direct' | 'room';

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
  place_label: string | null;
  category: PinCategory;
  lat: number;
  lng: number;
  intent_date: string;
  seeded: boolean;
  seed_note: string | null;
  expires_at: string;
};

/** city_rooms() — establishment rooms in a city. */
export type CityRoomRow = {
  chat_id: string;
  establishment_id: string;
  name: string;
  kind: 'hostel' | 'hotel' | 'other';
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
  created_at: string;
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

/** Row shape returned by incoming_requests(). */
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
};

/**
 * Row shape returned by sent_requests(). `state` deliberately collapses
 * pending/declined/expired into 'sent' — the DB never tells a sender they
 * were declined (invariant 4).
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
};

/** Row shape returned by my_chats(), pinned first then by last activity. */
export type ChatListRow = {
  chat_id: string;
  kind: ChatKind;
  chat_status: ChatStatus;
  /** Establishment name for rooms, the other person's name for direct chats. */
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

export type GroupRole = 'admin' | 'speaker' | 'member';

export type GroupSpeaking = 'everyone' | 'granted';

export type GroupRow = {
  chat_id: string;
  created_by: string | null;
  name: string;
  photo_path: string | null;
  speaking: GroupSpeaking;
  max_stay_until: string;
  created_at: string;
};

export type GroupMemberRow = {
  user_id: string;
  display_name: string | null;
  photo_path: string | null;
  role: GroupRole;
  departure_date: string;
  joined_at: string;
};

export type GroupInvitePreviewRow = {
  chat_id: string;
  name: string;
  photo_path: string | null;
  member_count: number;
  max_stay_until: string;
  speaking: GroupSpeaking;
  already_member: boolean;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string | null;
  image_path: string | null;
  /** Set when the SENDER took the message back. Distinct from moderator removal. */
  unsent_at?: string | null;
  created_at: string;
};

export type ReportReason =
  'flirtation_or_sexual' | 'harassment' | 'spam' | 'fake_profile' | 'safety_concern' | 'other';

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
};

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
  /** What the plan actually is, in the author's words. */
  note: string | null;
  /** Street or area the pin sits on, as the author confirmed it. */
  place_label: string | null;
  category: PinCategory;
  lat: number;
  lng: number;
  intent_date: string;
  seeded: boolean;
  seed_note: string | null;
  expires_at: string;
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
        };
        Update: never;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          reported_user_id: string;
          reason: ReportReason;
          details: string | null;
          context: string | null;
          created_at: string;
        };
        Insert: {
          reporter_id: string;
          reported_user_id: string;
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
        Args: { p_chat_id: string; p_limit?: number };
        Returns: RoomMessageRow[];
      };
      message_reaction_summary: {
        Args: { p_chat_id: string };
        Returns: ReactionSummaryRow[];
      };
      create_group: {
        Args: {
          p_name: string;
          p_max_stay_until: string;
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
          p_max_stay_until?: string | null;
          p_photo_path?: string | null;
          p_clear_photo?: boolean;
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
        Args: { p_reply_to: string; p_body: string };
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
      city_pins: {
        Args: { p_city_id: number };
        Returns: CityPinRow[];
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
    };
    Enums: {
      user_status: UserStatus;
      gender: Gender;
      moderation_status: ModerationStatus;
      social_platform: SocialPlatform;
      chat_status: ChatStatus;
      trip_status: TripStatus;
      request_source: RequestSource;
      verification_status: VerificationStatus;
      chat_kind: ChatKind;
    };
    CompositeTypes: Record<string, never>;
  };
};
