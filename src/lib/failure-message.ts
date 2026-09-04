/**
 * What to say to a person when something did not load or did not save.
 *
 * Three rules, and the middle one changed on 2026-08-31 (UX_PLAN.md D3: the
 * database may not write user-facing copy).
 *
 * A dropped connection is by far the commonest failure on the road, and it is
 * not the traveller's fault or the database's, so it gets its own sentence
 * instead of a stack frame.
 *
 * A known failure is recognised by the stable `hint` code the migration put
 * on the raise, or failing that by its exact lowercase fragment, and answered
 * with a sentence written HERE. The old rule was to show anything the
 * database wrote verbatim, on the grounds that "a message the DATABASE wrote
 * is already a sentence somebody chose" — which is true of 'trip is entirely
 * in the past' and false of 'cannot unmatch a closed conversation', a
 * lowercase schema fragment with a banned word in it that shipped to an
 * alert. What survives of the old rule is the capital-and-full-stop test: a
 * migration that writes an actual sentence ('That date has already passed.',
 * 'This chat has ended.') still gets it shown, so the database can keep
 * writing good copy — it just cannot ship a fragment by accident any more.
 *
 * Everything else gets the generic sentence, never the raw string, and never
 * the transport's own words ("Could not save: TypeError: Network request
 * failed").
 */

/** Anything that means "the request never reached the server". */
export function isOffline(error: unknown): boolean {
  const message = (error as { message?: unknown })?.message;
  const status = (error as { status?: unknown })?.status;
  if (status === 0) {
    return true;
  }
  if (typeof message !== 'string') {
    return false;
  }
  return /network request failed|failed to fetch|networkerror|fetcherror|timeout|typeerror/i.test(
    message
  );
}

/**
 * The two words the app uses whenever the PHONE, not the server, is the
 * problem — and the only place they are written.
 *
 * Every offline sentence below is built from this one phrase, and so is the
 * connection banner (`src/components/ui/connection-banner.tsx`). That matters
 * because the banner and an error message are usually on screen together: a
 * traveler who walks out of the cafe mid-conversation sees the bar under the
 * notch AND whatever the screen they were on says about its failed load. Two
 * different phrasings of the same fact reads as two different faults.
 */
export const NO_CONNECTION = 'No connection';

const OFFLINE = `${NO_CONNECTION}. This one needs the internet.`;

export const GENERIC_SAVE_FAILURE = 'Something went wrong. Try that again.';

// One sentence per failure, shared between the hint map and the string map.
// The relationship sentence is deliberately ONE sentence for every branch of
// the oracle-proofed check (review_fixes.sql: undiscoverable, blocked, no
// overlap, no pin all raise the same message) — mapping them to different
// sentences here would rebuild the existence oracle the database refuses to
// be.
const CHAT_OVER = 'This chat has already ended.';
const RECIPIENT_UNAVAILABLE = 'You cannot say hi to this traveler right now.';
// open_direct_chat folds a blocked pair, a business and a guest recipient
// into ONE raise, on the same oracle-proofing grounds as the say-hi family
// above, so this is one sentence true of all three. NOT the say-hi one: there
// is no say-hi on this path, which is the whole point of the message screen.
// It reached the founder as the bare "Something went wrong. Try that again."
// because the raise carries no hint and its lowercase message is not a
// written sentence.
const DIRECT_CHAT_UNAVAILABLE = 'You cannot message this traveler one to one right now.';
const POST_DAILY_CAP = 'That is as much as you can post today. More tomorrow.';
const ACCOUNT_CLOSED =
  'Your account is closed. Write to us from House rules and help if you think that is wrong.';
const SIGNED_OUT = 'You have been signed out. Sign in and try that again.';
const GUEST_WALL = 'Make an account to do that.';

/**
 * Keyed on the stable `hint` code the live raise clauses carry
 * (supabase migration a_failure_says_what_to_do). Codes, not English prose:
 * the same message is duplicated across seven superseded migrations, so a
 * string key breaks the day one is reworded, and a code does not.
 */
const HINT_COPY: Record<string, string> = {
  hello_daily_cap: 'That is all your first messages for today. More tomorrow.',
  hello_already_sent: 'You already said hi. It will be in Chat if they answer.',
  already_connected: 'You two already have a chat.',
  recipient_unavailable: RECIPIENT_UNAVAILABLE,
  chat_over: CHAT_OVER,
  trip_cap:
    'Five trips is the most you can have posted at once. Delete one from your profile to add this.',
  pin_cap:
    'Ten pins is the most you can have up at once. One will expire soon, or take one down from the map.',
  trip_daily_cap: POST_DAILY_CAP,
  pin_daily_cap: POST_DAILY_CAP,
  photo_daily_cap: POST_DAILY_CAP,
  profile_daily_cap: 'That is as much profile editing as you can do today. More tomorrow.',
  block_daily_cap:
    'You have blocked a lot of people in one day. If somebody is making new accounts to reach you, write to us from House rules and help and we will deal with it at our end.',
  report_daily_cap:
    'You have reported a lot of people in one day. If something serious is happening, write to us from House rules and help and we will deal with it at our end.',
  message_throttle: 'One moment, then try again.',
  account_closed: ACCOUNT_CLOSED,
  not_authenticated: SIGNED_OUT,
  trip_past: 'That trip has already finished.',
  guidelines: 'That breaks our house rules. Reword it and try again.',
  // validate_business_link (20260903090000): the two links the database
  // refuses because of where they go rather than how they are written.
  short_link: 'Use the real address rather than a short link, so travelers can see where it goes.',
  bare_address: 'That link needs a real domain, not a bare address.',
};

/**
 * The belt under the hints: the exact lowercase fragments the deployed
 * database can still raise, mapped to the same sentences. Superseded the day
 * every live function carries a hint, kept because a fragment that slips
 * through is shown to a person.
 */
const DB_COPY: Record<string, string> = {
  'active trip limit reached (5)': HINT_COPY.trip_cap,
  'active pin limit reached (10)': HINT_COPY.pin_cap,
  'photo limit reached (9 per user)': 'Nine photos is the most a profile can hold.',
  'photo limit reached (7 per user)': 'Nine photos is the most a profile can hold.',
  'daily trip limit reached': POST_DAILY_CAP,
  'daily pin limit reached': POST_DAILY_CAP,
  'daily photo upload limit reached': POST_DAILY_CAP,
  'daily profile update limit reached': HINT_COPY.profile_daily_cap,
  'cannot unmatch a closed conversation': CHAT_OVER,
  'chat not found': CHAT_OVER,
  'request already sent to this traveler': HINT_COPY.hello_already_sent,
  'hello already sent to this traveler': HINT_COPY.hello_already_sent,
  'already connected with this traveler': HINT_COPY.already_connected,
  'recipient unavailable': RECIPIENT_UNAVAILABLE,
  'that traveler is unavailable': DIRECT_CHAT_UNAVAILABLE,
  'daily request limit reached': HINT_COPY.hello_daily_cap,
  'daily hello limit reached': HINT_COPY.hello_daily_cap,
  'daily block limit reached': HINT_COPY.block_daily_cap,
  'daily report limit reached': HINT_COPY.report_daily_cap,
  'not authenticated': SIGNED_OUT,
  'account banned': ACCOUNT_CLOSED,
  'account suspended': ACCOUNT_CLOSED,
  'sending too fast — wait a moment': HINT_COPY.message_throttle,
  'sending too fast, give it a moment': HINT_COPY.message_throttle,
  'trip is entirely in the past': 'That trip has already finished.',
  // Both phrasings, as the BELT under the hint. Every live definition of the
  // six screening functions now raises with hint = 'guidelines' (the
  // one-name-for-the-rules migration), so the resolution above is by code and
  // survives the next rewording. These two keys are here for what is still
  // deployed until that migration lands, in either deploy order.
  'that text breaks our community guidelines': HINT_COPY.guidelines,
  'that text breaks our house rules': HINT_COPY.guidelines,
  // Lowercase sentences promoted rather than dropped to the generic (the
  // scan the D3 package asked for): every one is reachable from a button.
  'three pins is the limit': 'Three pins is the limit. Unpin one first.',
  'that is as many businesses as you can write to today':
    'That is as many businesses as you can write to today.',
  'that is as many places as you can write to today':
    'That is as many places as you can write to today.',
  'that is as many businesses as you can rate today':
    'That is as many businesses as you can rate today.',
  'that is as many places as you can rate today': 'That is as many places as you can rate today.',
  // The business email-code flow, whose every failure is typed at a keyboard.
  'that code is not right': 'That code is not right. Check it and try again.',
  'that code has expired. ask for a new one': 'That code has expired. Ask for a new one.',
  'too many tries. ask for a new code': 'Too many tries. Ask for a new code.',
  'that is as many codes as we can send today':
    'That is as many codes as we can send today. Try again tomorrow.',
  'ask for a code first': 'Ask for a code first.',
  'too many tries today. have another go tomorrow':
    'Too many tries today. Have another go tomorrow.',
  // Guest caps: informative, so they beat the plain guest-wall sentence.
  'a guest can be in 10 chats at once. make an account for more':
    'A guest can be in ten chats at once. Make an account for more.',
  'daily limit reached. make an account to keep going':
    'That is the guest limit for today. Make an account to keep going.',
  // Small written checks from the business editors.
  'links have to start with https://': 'A link has to start with https://.',
  'use the real address, not a short link': HINT_COPY.short_link,
  'that link needs a real domain': HINT_COPY.bare_address,
  'that does not look like an email address': 'That does not look like an email address.',
  'that does not look like a phone number': 'That does not look like a phone number.',
  'ten links is plenty': 'Ten links is plenty.',
  'three tags is plenty': 'Three tags is plenty.',
  'pick a name between 1 and 50 characters': 'Pick a name between 1 and 50 characters.',
  'get verified before choosing who can see you': 'Get verified before choosing who can see you.',
  'add a profile photo before verifying': 'Add a profile photo first.',
};

// Two families are parameterised, so they are prefixes rather than fragments.
const MARKER_OUTSIDE = 'Drag the marker onto your door, or pick the right city.';

/** The mechanical form of "the database wrote an actual sentence". */
function isWrittenSentence(raw: string): boolean {
  return /^[A-Z]/.test(raw) && /[.!?]$/.test(raw);
}

/** For a mutation the user just triggered: something they tried to save. */
export function saveFailureMessage(error: unknown): string {
  if (isOffline(error)) {
    return OFFLINE;
  }
  const hint = (error as { hint?: unknown })?.hint;
  if (typeof hint === 'string' && HINT_COPY[hint] != null) {
    return HINT_COPY[hint];
  }
  const raw = (error as { message?: unknown })?.message;
  if (typeof raw !== 'string' || !raw.trim()) {
    return GENERIC_SAVE_FAILURE;
  }
  const trimmed = raw.trim();
  if (isWrittenSentence(trimmed)) {
    return trimmed;
  }
  const fragment = trimmed.toLowerCase();
  if (DB_COPY[fragment] != null) {
    return DB_COPY[fragment];
  }
  // The guest-wall family carries a suffix per act ('make an account to send
  // photos', '…to post a trip'), so it is a prefix, not a fragment.
  if (fragment.startsWith('make an account')) {
    return GUEST_WALL;
  }
  // 'that marker is not in %' interpolates the city, so the whole string can
  // never be a map key. The instruction half is the part worth keeping; the
  // city is already on the screen the marker sits on.
  if (fragment.startsWith('that marker is not in')) {
    return MARKER_OUTSIDE;
  }
  return GENERIC_SAVE_FAILURE;
}

/** For a query that failed: something the screen wanted to show. */
export function loadFailureMessage(error: unknown, what: string): string {
  if (isOffline(error)) {
    return `${NO_CONNECTION}, so ${what} could not load.`;
  }
  return `${what[0].toUpperCase()}${what.slice(1)} could not load.`;
}

/** Exported for the copy tests: every sentence this file can say. */
export const FAILURE_COPY_VALUES: string[] = [
  OFFLINE,
  GENERIC_SAVE_FAILURE,
  MARKER_OUTSIDE,
  ...Object.values(HINT_COPY),
  ...Object.values(DB_COPY),
];
