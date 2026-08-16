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
  gender: Gender;
  verified: boolean;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const PROFILE_COLUMNS =
  'user_id, display_name, age, home_city, home_country, languages, bio, gender, verified, onboarding_completed_at, created_at, updated_at';

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

/** Row shape returned by the get_matches() RPC. */
export type MatchRow = {
  trip_id: string;
  user_id: string;
  display_name: string | null;
  age: number | null;
  verified: boolean;
  languages: string[];
  bio: string | null;
  gender: Gender;
  city_id: number;
  city_name: string;
  city_country: string;
  overlap_start: string;
  overlap_end: string;
  photo_path: string | null;
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

/** Row shape returned by my_chats(). */
export type ChatListRow = {
  chat_id: string;
  chat_status: ChatStatus;
  other_user_id: string;
  other_display_name: string | null;
  other_photo_path: string | null;
  first_message: string | null;
  first_message_sender_id: string | null;
  created_at: string;
};

export type SendRequestResult = {
  request_id: string;
  delivered: boolean;
  blocked: boolean;
};

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
  category: PinCategory;
  lat: number;
  lng: number;
  intent_date: string;
  seeded: boolean;
  seed_note: string | null;
  expires_at: string;
};

/** Row shape returned by heat_cells() — deliberately identifier-free. */
export type HeatCellRow = {
  cell_lat: number;
  cell_lng: number;
  category: PinCategory;
  pin_count: number;
};

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          status: UserStatus;
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
      pins: {
        Row: {
          id: string;
          user_id: string | null;
          city_id: number;
          venue_name: string;
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
          category: PinCategory;
          lat: number;
          lng: number;
          intent_date: string;
          expires_at: string;
        };
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
        Args: Record<string, never>;
        Returns: ChatListRow[];
      };
      city_pins: {
        Args: { p_city_id: number };
        Returns: CityPinRow[];
      };
      heat_cells: {
        Args: { p_city_id: number; p_date?: string | null };
        Returns: HeatCellRow[];
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
    };
    CompositeTypes: Record<string, never>;
  };
};
