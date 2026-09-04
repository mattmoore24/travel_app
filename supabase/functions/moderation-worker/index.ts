// Claude moderation worker. Drains nine server-side queues:
//
//   1. message_requests in 'pending_moderation'  -> apply_message_verdict
//   2. profile_photos   in 'pending'             -> apply_photo_verdict
//   2b. business_photos in 'pending'             -> apply_business_photo_verdict
//   2c. business_posts with a pending photo      -> apply_business_post_photo_verdict
//   2d. groups with a pending photo              -> apply_group_photo_verdict
//   3. verification_requests in 'pending'        -> apply_verification_verdict
//   4. messages with a pending photo             -> apply_chat_photo_verdict
//   5. business_verifications in 'pending'       -> apply_business_verification_verdict
//   6. business_scans in 'pending'               -> apply_business_scan_verdict
//
// Deploy:   supabase functions deploy moderation-worker
// Secrets:  ANTHROPIC_API_KEY + MODERATION_PROMPTS (see prompts.example.json),
//           both synced from GitHub secrets by the deploy workflow.
// Schedule: every minute (Dashboard -> Edge Functions -> Schedules), then flip
//           app_config require_llm_moderation / require_photo_moderation.
//
// Failure semantics (hard rule 5 = fail CLOSED, never fail open):
//   * A held message is only ever released by an explicit 'allow' verdict.
//   * API errors leave items queued and bump an attempts counter; after
//     MAX_ATTEMPTS a message is blocked and a photo is removed with engine
//     'failsafe' (owner told to retry; explicitly NOT a strike — see
//     apply_message_verdict/apply_photo_verdict), and a verification is
//     rejected with a "try again" reason.
//   * A model refusal (stop_reason 'refusal') means the content was extreme:
//     treated as a block verdict.
// deno-lint-ignore-file no-explicit-any
//
// The npm specifiers are pinned to exact versions. A Supabase function is
// bundled at DEPLOY time, not at commit time, so a floating specifier means
// the classifier's runtime is whatever npm published most recently — and a
// deploy that changes nothing in this file can still change what it runs.
// Every check would stay green through it: `functions deploy` succeeds, the
// deploy's own probe still gets its 401, and the only symptom is held content
// that never moves. Raise these deliberately, in a commit that says so.
//
// The jsr one keeps its major range: jsr.io is not reachable from where this
// was written, so an exact version here would be a guess, and a guess that is
// wrong fails the bundle for every function in the project. A major range on
// a client this code uses for `.from`/`.rpc`/`createSignedUrl` is the smaller
// exposure of the two.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0';
import { z } from 'npm:zod@4.5.4';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.122.0/helpers/zod';

const MODEL = 'claude-opus-5';
const MAX_ATTEMPTS = 10;
const MESSAGES_PER_TICK = 10;
const PHOTOS_PER_TICK = 5;
const VERIFICATIONS_PER_TICK = 3;
const CHAT_PHOTOS_PER_TICK = 8;
const STOREFRONTS_PER_TICK = 3;
const SCANS_PER_TICK = 3;
const SIGNED_URL_TTL_SECONDS = 600;

// THE TICK HAS A CLOCK, because before it had one a slow queue could starve
// every queue behind it for ever.
//
// Nine queues run in sequence and each item is a model call. Nothing bounded
// how long that took, so the arithmetic was: 8 chat photos + 10 held messages
// + 20 photos + 3 selfies + 3 storefronts + 3 scans, several of them at
// CAREFUL effort over an image. Past the platform's wall clock the isolate is
// killed mid-item, and killed is worse than failed: the `note_*_attempt` call
// that records the try never runs, so `moderation_attempts` does not move and
// the MAX_ATTEMPTS failsafe never fires either. The queue behind the slow one
// is then never reached, on this tick or any tick after it, and the outward
// symptom is a first hello held for ever while `functions deploy` succeeds,
// the deploy's probe answers 401, and every check in the repo is green.
//
// So: a budget for the tick, and a slice of it for each queue. A slice is
// measured from the moment its queue starts and capped by the tick's own end,
// which means time a fast queue does not spend is inherited by the ones
// behind it, and no queue can ever eat the tick. Whatever is left over waits
// for the next tick sixty seconds later, which is what a queue is for.
//
// 50s against a cron that fires every minute: a tick that overran the minute
// would have the next one re-select the same rows and classify them twice.
const TICK_BUDGET_MS = 50_000;
const QUEUE_BUDGET_MS = {
  chatPhotos: 8_000,
  messages: 10_000,
  photos: 6_000,
  businessPhotos: 5_000,
  postPhotos: 4_000,
  groupPhotos: 4_000,
  verifications: 5_000,
  storefronts: 5_000,
  scans: 3_000,
} as const;

// The slices add up to the budget rather than overrunning it, and that is the
// whole point: it means the worst a queue can do to the one behind it is
// spend its own slice, so every queue is reached on every tick and starts at
// least one item. Slices that summed to more than the budget would put the
// starvation back, just further down the list. A test holds the sum.
//
// The group-photo slice (20260903050000) was paid for by trimming four
// others rather than by raising the tick: the tick is 50s against a cron that
// fires every minute, and a tick that overran the minute would have the next
// one re-select the same rows and classify them twice. A slice is a FLOOR,
// not a ceiling - the check runs before each item, so every queue still
// starts at least one item, and time a fast queue leaves is inherited by the
// ones behind it.

// One hung request must not be able to take the tick with it. The SDK's own
// default is a TEN MINUTE timeout with two automatic retries — thirty minutes
// of one item, against a platform wall clock the isolate does not survive.
// And an isolate killed mid-item is strictly worse than a call that failed:
// the `note_*_attempt` write never runs, so the item does not even count as
// tried and MAX_ATTEMPTS never arrives.
//
// maxRetries is 0 on purpose. The queue IS the retry, sixty seconds later,
// and going round that way records the attempt.
const REQUEST_TIMEOUT_MS = 90_000;
const REQUEST_RETRIES = 0;

const MessageVerdict = z.object({
  action: z.enum(['allow', 'block']),
  category: z.enum(['ok', 'flirtation', 'sexual', 'harassment', 'spam', 'scam', 'other']),
  confidence: z.number(),
  reason: z.string(),
});

const PhotoVerdict = z.object({
  action: z.enum(['allow', 'block']),
  category: z.enum(['ok', 'explicit', 'suggestive', 'violent', 'other_violation']),
  confidence: z.number(),
  reason: z.string(),
});

const VerificationVerdict = z.object({
  action: z.enum(['approve', 'reject']),
  confidence: z.number(),
  // User-facing when rejecting ("the selfie is too dark to compare"), and
  // written in the language of the subject's own phone when their profile
  // carries one. A null locale means English, silently.
  reason: z.string(),
  // The same sentence in English, and REQUIRED by this schema rather than
  // optional. Nobody is ever shown it: it exists so that an appeal about
  // somebody's face is adjudicable by a founder who cannot read Thai. Make it
  // optional and the one verdict worth appealing is the one that arrives
  // without it.
  reason_en: z.string(),
});

// Three outcomes, not two. 'uncertain' exists because a hand-painted sign in
// a script the model reads poorly is a real business having a bad day, and
// refusing it outright would be this app being confidently wrong about
// somebody's livelihood. Uncertain goes to the founder.
const StorefrontVerdict = z.object({
  action: z.enum(['approve', 'reject', 'uncertain']),
  confidence: z.number(),
  // User-facing on a reject: what to do differently, never an accusation, in
  // the owner's own language when their profile carries a locale.
  reason: z.string(),
  // English, always, and required for the same reason as above — with one
  // extra reader here: an 'uncertain' storefront mails the founder to finish
  // the call by hand, and that mail quotes reason_en
  // (20260903010000_a_verdict_speaks_your_language.sql).
  reason_en: z.string(),
});

const ImpersonationVerdict = z.object({
  impersonation_plausible: z.boolean(),
  confidence: z.number(),
  reason: z.string(),
});

/**
 * The one line that decides what language a verdict speaks.
 *
 * Appended to the content block of the two queues whose verdict is READ BY
 * THE PERSON IT IS ABOUT — a selfie, and a storefront. Nowhere else: a
 * message verdict is never shown to anybody (hard rule 5 keeps every
 * moderation outcome away from the sender), and an impersonation verdict is
 * read by the founder alone.
 *
 * A null, empty or unparseable tag falls back to English SILENTLY. It must
 * never fall back to a nearest guess: `languageTag` is the phone's language,
 * not necessarily one the person reads well, and inventing a better guess
 * from a country or a name is how somebody gets a rejection in a language
 * they do not speak, written by an app that was sure it knew better.
 */
function languageLine(locale: string | null | undefined): string {
  const tag = typeof locale === 'string' ? locale.trim() : '';
  const english =
    'Write `reason_en` in English, plain and short. Never an accusation: ' +
    'say what to do differently. No em dashes.';
  if (tag.length === 0 || tag.length > 16) {
    return `THE PERSON THIS IS ABOUT: no language recorded. Write \`reason\` in English. ${english} The two may be the same sentence.`;
  }
  return (
    `THE PERSON THIS IS ABOUT READS: ${tag} (a BCP 47 tag). Write \`reason\` ` +
    `in that language, addressed to them, in the same plain register you ` +
    `would use in English. If you cannot write that language well, write ` +
    `\`reason\` in English rather than badly. ${english}`
  );
}

// The classifier instructions are deliberately NOT in this (public) source:
// publishing the exact BLOCK/ALLOW rules would hand evaders a how-to guide.
// They live in function secrets as JSON: MODERATION_PROMPTS carries
// { message, photo, verification }, and MODERATION_PROMPTS_BUSINESS
// optionally carries { storefront, impersonation }. prompts.example.json
// documents both shapes, and the deploy workflow syncs the GitHub secrets to
// the function.
// Absent or malformed prompts fail CLOSED (hard rule 5): the worker refuses
// to classify, queues hold, and admin_ops_health raises
// oldest_held_message_minutes rather than anything auto-approving.
type ModerationPrompts = {
  message: string;
  photo: string;
  verification: string;
  /**
   * The two business keys are OPTIONAL, and that is load-bearing rather than
   * lazy. loadPrompts returns null unless every REQUIRED key is present, and
   * a null there stops all four original queues dead. If these were required,
   * deploying this code before the MODERATION_PROMPTS secret caught up would
   * take message moderation, photo moderation and selfie verification down
   * with it. Absent, exactly one business queue pauses and says so.
   */
  storefront?: string;
  impersonation?: string;
};

function parseJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Malformed JSON is the same as missing. It must not throw here: this
    // runs at module scope, and a throw would take the whole function down
    // rather than failing one queue closed.
    return {};
  }
}

/**
 * The prompts, from one secret or two.
 *
 * MODERATION_PROMPTS holds the three original classifiers.
 * MODERATION_PROMPTS_BUSINESS optionally holds the two business ones, and the
 * split exists for one practical reason: a GitHub secret is write-only, so
 * nobody can read the working value back to append to it. Requiring all five
 * in one secret would mean retyping three live, tuned classifier prompts from
 * memory to add a fourth, and getting one of them slightly wrong would quietly
 * change how every hello in the app is screened.
 *
 * Either secret may carry either set; the business one wins on a clash, since
 * it is the more specific of the two. Put all five in MODERATION_PROMPTS and
 * this still works.
 */
function loadPrompts(): ModerationPrompts | null {
  const base = parseJson(Deno.env.get('MODERATION_PROMPTS'));
  const business = parseJson(Deno.env.get('MODERATION_PROMPTS_BUSINESS'));
  const merged = { ...base, ...business } as Record<string, unknown>;
  const required = ['message', 'photo', 'verification'] as const;
  if (
    required.every((key) => typeof merged[key] === 'string' && (merged[key] as string).length >= 40)
  ) {
    return merged as ModerationPrompts;
  }
  return null;
}

const PROMPTS = loadPrompts();

/** An optional prompt, or null when the secret has not caught up yet. */
function optionalPrompt(key: 'storefront' | 'impersonation'): string | null {
  const value = PROMPTS?.[key];
  return typeof value === 'string' && value.length >= 40 ? value : null;
}

type WorkerReport = {
  messages: { approved: number; blocked: number; failed: number };
  photos: { approved: number; rejected: number; failed: number };
  businessPhotos: { approved: number; rejected: number; failed: number };
  postPhotos: { approved: number; rejected: number; failed: number };
  groupPhotos: { approved: number; rejected: number; failed: number };
  chatPhotos: { approved: number; rejected: number; failed: number };
  verifications: { approved: number; rejected: number; failed: number; waiting: number };
  storefronts: { approved: number; rejected: number; uncertain: number; failed: number };
  scans: { cleared: number; flagged: number; failed: number };
  notes: string[];
};

// Classifies with structured output; returns the parsed verdict or throws.
// A refusal stop reason returns null so callers can map it to a block.
//
// `effort` is the latency dial, and the only one worth turning: the model
// thinks adaptively, so how long a verdict takes is set by this and not by
// max_tokens (which is a ceiling, and costs nothing when unspent).
//
// FAST is for the two queues a person is watching in a live conversation — a
// photo held behind a placeholder, and a first hello held before delivery.
// Both are bounded either/or calls against a tuned prompt, and neither gets
// any safer for thinking longer about it.
//
// CAREFUL is the default, and stays the default deliberately. Verification,
// storefronts and impersonation are judgments about who somebody IS: a wrong
// call there withdraws a badge, darkens a real business, or accuses somebody.
// Nobody is staring at a placeholder while those run, so there is nothing to
// buy by hurrying them.
const FAST = 'low' as const;
const CAREFUL = 'high' as const;

async function classify<T>(
  anthropic: Anthropic,
  system: string,
  content: Anthropic.MessageParam['content'],
  schema: z.ZodType<T>,
  effort: typeof FAST | typeof CAREFUL = CAREFUL
): Promise<T | null> {
  const response = await anthropic.messages.parse({
    model: MODEL,
    // Opus 5 thinks adaptively and thinking tokens count against max_tokens —
    // generous headroom keeps a long think from truncating the verdict (which
    // would read as a classification failure). Unspent headroom is free.
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(schema), effort },
  });
  if (response.stop_reason === 'refusal') {
    return null;
  }
  if (response.parsed_output == null) {
    throw new Error('classifier returned no parseable verdict');
  }
  return response.parsed_output;
}

function isAuthError(error: unknown): boolean {
  return error instanceof Anthropic.AuthenticationError;
}

/**
 * Service role only.
 *
 * This is scheduled work over server-only tables — the push queue, the
 * moderation backlog, the support inbox — and it used to run for whoever
 * asked. A Supabase function accepts the ANON key as a valid JWT, and the
 * anon key ships inside the app, so anyone who pulled it out of the IPA could
 * drive this in a loop.
 *
 * The check is the `role` claim, not a comparison against
 * SUPABASE_SERVICE_ROLE_KEY. The first attempt at this compared key strings
 * and took moderation down for half an hour on 2026-08-21, and I never
 * established whether the vault's bearer differed from this function's own
 * env var or whether the shared module it lived in simply failed to bundle.
 * The claim sidesteps both: any valid service-role credential for this
 * project satisfies it, and this is written inline so there is nothing to
 * bundle.
 *
 * Reading an unverified payload would be worthless, so note WHY it is not:
 * these functions are deployed without --no-verify-jwt and the project has no
 * config.toml, so verify_jwt is on and the platform has already checked the
 * signature before this runs. If that ever changes, this check becomes
 * forgeable and must change with it.
 *
 * The deploy proves it: it POSTs each worker with the ANON key and requires a
 * 401, which fails if the guard is missing, if it is letting anon through, or
 * if the function is not running at all.
 */
function isServiceCaller(req: Request): boolean {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const payload = token.split('.')[1];
  if (!payload) {
    return false;
  }
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(atob(padded))?.role === 'service_role';
  } catch {
    return false;
  }
}

function refuse(): Response {
  return Response.json({ error: 'not authorized' }, { status: 401 });
}

Deno.serve(async (req) => {
  if (!isServiceCaller(req)) {
    return refuse();
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY secret is not set; queues left untouched' },
      { status: 503 }
    );
  }
  if (!PROMPTS) {
    return Response.json(
      { error: 'MODERATION_PROMPTS secret missing or malformed; queues left untouched' },
      { status: 503 }
    );
  }
  const anthropic = new Anthropic({
    apiKey: anthropicKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: REQUEST_RETRIES,
  });
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const report: WorkerReport = {
    messages: { approved: 0, blocked: 0, failed: 0 },
    photos: { approved: 0, rejected: 0, failed: 0 },
    businessPhotos: { approved: 0, rejected: 0, failed: 0 },
    postPhotos: { approved: 0, rejected: 0, failed: 0 },
    groupPhotos: { approved: 0, rejected: 0, failed: 0 },
    chatPhotos: { approved: 0, rejected: 0, failed: 0 },
    verifications: { approved: 0, rejected: 0, failed: 0, waiting: 0 },
    storefronts: { approved: 0, rejected: 0, uncertain: 0, failed: 0 },
    scans: { cleared: 0, flagged: 0, failed: 0 },
    notes: [],
  };

  const signedUrl = async (bucket: string, path: string): Promise<string> => {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(`signed url for ${bucket}/${path}: ${error?.message ?? 'no url'}`);
    }
    return data.signedUrl;
  };

  // A queue's permission to start one more item. Called once per queue, just
  // before its loop, and asked before each item — never in the middle of one,
  // so nothing is ever abandoned half classified. The first refusal writes a
  // note, so a tick that ran out of time says so in its own report instead of
  // looking identical to a tick with nothing to do.
  const startedAt = Date.now();
  const tickEndsAt = startedAt + TICK_BUDGET_MS;
  const budgetFor = (queue: keyof typeof QUEUE_BUDGET_MS) => {
    const endsAt = Math.min(Date.now() + QUEUE_BUDGET_MS[queue], tickEndsAt);
    let noted = false;
    return () => {
      if (Date.now() < endsAt) {
        return true;
      }
      if (!noted) {
        noted = true;
        report.notes.push(`${queue}: out of time this tick, the rest waits for the next one`);
      }
      return false;
    };
  };

  // The order of these six queues is the order somebody experiences them,
  // not the order they were written. A chat photo is the only one with a
  // person watching a placeholder in a live conversation, so it drains
  // first; a held hello is second because somebody is waiting on a reply.
  // Verification, storefronts and scans are all read minutes later at the
  // earliest, and they are the slowest classifications, so putting them
  // last costs nobody anything.
  // -- 1. Photos posted into chats and rooms ------------------------------
  // A room can be read by anyone, so an unscreened photo there is the most
  // exposed content in the product. Same classifier, same fail-closed rule.
  const { data: chatPhotos } = await supabase
    .from('messages')
    .select('id, image_path')
    .eq('moderation_status', 'pending')
    .not('image_path', 'is', null)
    .order('created_at')
    .limit(CHAT_PHOTOS_PER_TICK);

  const hasTimeChatPhotos = budgetFor('chatPhotos');
  for (const photo of chatPhotos ?? []) {
    if (!hasTimeChatPhotos()) {
      break;
    }
    try {
      const url = await signedUrl('chat-photos', photo.image_path);
      const verdict = await classify(
        anthropic,
        PROMPTS.photo,
        [
          { type: 'image', source: { type: 'url', url } },
          { type: 'text', text: 'Moderate this photo posted in a travel chat.' },
        ],
        PhotoVerdict,
        FAST
      );
      const payload = verdict
        ? { ...verdict, engine: 'claude-moderator', model: MODEL }
        : {
            action: 'block',
            category: 'refusal',
            reason: 'the model refused to process this content',
            engine: 'claude-moderator',
            model: MODEL,
          };
      const { error } = await supabase.rpc('apply_chat_photo_verdict', {
        p_message_id: photo.id,
        p_verdict: payload,
      });
      if (error) {
        throw new Error(`apply_chat_photo_verdict: ${error.message}`);
      }
      if (payload.action === 'allow') {
        report.chatPhotos.approved += 1;
      } else {
        report.chatPhotos.rejected += 1;
      }
    } catch (error) {
      if (isAuthError(error)) {
        return Response.json(
          { error: 'anthropic auth failed — check ANTHROPIC_API_KEY', report },
          { status: 503 }
        );
      }
      // Left pending, which means invisible to everyone but the sender —
      // already fail-closed. The next tick retries.
      report.chatPhotos.failed += 1;
      report.notes.push(`chat photo ${photo.id}: ${(error as Error).message}`);
    }
  }

  // -- 2. Held first messages -----------------------------------------------
  const { data: held, error: heldError } = await supabase
    .from('message_requests')
    .select('id, first_message, profile_element, source, moderation_attempts')
    .eq('status', 'pending_moderation')
    .order('created_at')
    .limit(MESSAGES_PER_TICK);
  if (heldError) {
    return Response.json({ error: heldError.message }, { status: 500 });
  }

  const hasTimeMessages = budgetFor('messages');
  for (const request of held ?? []) {
    if (!hasTimeMessages()) {
      break;
    }
    try {
      const verdict = await classify(
        anthropic,
        PROMPTS.message,
        [
          {
            type: 'text',
            text:
              `Profile element the sender is replying to: ${request.profile_element ?? 'none'}\n` +
              `Request source: ${request.source}\n` +
              `First message:\n${request.first_message}`,
          },
        ],
        MessageVerdict,
        FAST
      );
      const payload = verdict
        ? { ...verdict, engine: 'claude-moderator', model: MODEL }
        : {
            action: 'block',
            category: 'refusal',
            reason: 'the model refused to process this content',
            engine: 'claude-moderator',
            model: MODEL,
          };
      const { error } = await supabase.rpc('apply_message_verdict', {
        p_request_id: request.id,
        p_verdict: payload,
      });
      if (error) {
        throw new Error(`apply_message_verdict: ${error.message}`);
      }
      if (payload.action === 'allow') {
        report.messages.approved += 1;
      } else {
        report.messages.blocked += 1;
      }
    } catch (error) {
      if (isAuthError(error)) {
        return Response.json(
          { error: 'anthropic auth failed — check ANTHROPIC_API_KEY', report },
          { status: 503 }
        );
      }
      report.messages.failed += 1;
      const attempts = (request.moderation_attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Fail closed, without a strike; the sender is told to retry.
        const { error: rpcError } = await supabase.rpc('apply_message_verdict', {
          p_request_id: request.id,
          p_verdict: {
            action: 'block',
            category: 'moderation_unavailable',
            reason: `classification failed ${attempts} times`,
            engine: 'failsafe',
          },
        });
        report.notes.push(
          rpcError
            ? `message ${request.id}: failsafe block failed: ${rpcError.message}`
            : `message ${request.id}: failsafe block after ${attempts} attempts`
        );
      } else {
        const { error: bumpError } = await supabase
          .from('message_requests')
          .update({ moderation_attempts: attempts })
          .eq('id', request.id);
        report.notes.push(
          `message ${request.id}: ${(error as Error).message}` +
            (bumpError ? ` (attempts update failed: ${bumpError.message})` : '')
        );
      }
    }
  }

  // -- 3. Pending profile photos --------------------------------------------
  const { data: photos } = await supabase
    .from('profile_photos')
    .select('id, storage_path, moderation_attempts')
    .eq('moderation_status', 'pending')
    .lt('moderation_attempts', MAX_ATTEMPTS)
    .order('created_at')
    .limit(PHOTOS_PER_TICK);

  const hasTimePhotos = budgetFor('photos');
  for (const photo of photos ?? []) {
    if (!hasTimePhotos()) {
      break;
    }
    try {
      const url = await signedUrl('profile-photos', photo.storage_path);
      const verdict = await classify(
        anthropic,
        PROMPTS.photo,
        [
          { type: 'image', source: { type: 'url', url } },
          { type: 'text', text: 'Moderate this profile photo.' },
        ],
        PhotoVerdict
      );
      const payload = verdict
        ? { ...verdict, engine: 'claude-moderator', model: MODEL }
        : {
            action: 'block',
            category: 'refusal',
            reason: 'the model refused to process this content',
            engine: 'claude-moderator',
            model: MODEL,
          };
      const { error } = await supabase.rpc('apply_photo_verdict', {
        p_photo_id: photo.id,
        p_verdict: payload,
      });
      if (error) {
        throw new Error(`apply_photo_verdict: ${error.message}`);
      }
      if (payload.action === 'allow') {
        report.photos.approved += 1;
      } else {
        report.photos.rejected += 1;
      }
    } catch (error) {
      if (isAuthError(error)) {
        return Response.json(
          { error: 'anthropic auth failed — check ANTHROPIC_API_KEY', report },
          { status: 503 }
        );
      }
      report.photos.failed += 1;
      const attempts = (photo.moderation_attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Fail closed like messages: remove (no strike) and tell the owner to
        // retry, instead of leaving the photo stuck "In review" forever.
        const { error: rpcError } = await supabase.rpc('apply_photo_verdict', {
          p_photo_id: photo.id,
          p_verdict: {
            action: 'block',
            category: 'moderation_unavailable',
            reason: `classification failed ${attempts} times`,
            engine: 'failsafe',
          },
        });
        report.notes.push(
          rpcError
            ? `photo ${photo.id}: failsafe reject failed: ${rpcError.message}`
            : `photo ${photo.id}: failsafe reject after ${attempts} attempts`
        );
      } else {
        const { error: bumpError } = await supabase
          .from('profile_photos')
          .update({ moderation_attempts: attempts })
          .eq('id', photo.id);
        report.notes.push(
          `photo ${photo.id}: ${(error as Error).message}` +
            (bumpError ? ` (attempts update failed: ${bumpError.message})` : '')
        );
      }
    }
  }

  // -- 3b. Pending business photos -------------------------------------------
  //
  // These had no pipeline at all. `business_photos.moderation_status` defaults
  // to 'pending' and nothing ever moved it, while every traveler-facing read
  // filters on 'approved' — so no photo of a business had ever been seen by
  // anybody but its owner, and business signup's photo step could not be
  // passed, because the count it gates on comes from `business_detail` and was
  // pinned at zero. The trigger added in 20260829180000 handles the flag-off
  // case; this is the flag-on one, and production runs with the flag on.
  //
  // Same shape as the profile branch above, with a different question: the
  // subject is a room or a shopfront rather than a face, and the thing that
  // matters is whether it is a photo of the place at all.
  const { data: businessPhotos } = await supabase
    .from('business_photos')
    .select('id, business_id, storage_path, moderation_attempts')
    .eq('moderation_status', 'pending')
    .lt('moderation_attempts', MAX_ATTEMPTS)
    .order('created_at')
    .limit(PHOTOS_PER_TICK);

  const hasTimeBusinessPhotos = budgetFor('businessPhotos');
  for (const photo of businessPhotos ?? []) {
    if (!hasTimeBusinessPhotos()) {
      break;
    }
    try {
      const url = await signedUrl('business-photos', photo.storage_path);
      const verdict = await classify(
        anthropic,
        PROMPTS.photo,
        [
          { type: 'image', source: { type: 'url', url } },
          {
            type: 'text',
            text:
              'Moderate this photo of a business, uploaded by the person who runs it. ' +
              'It should show the place, its food, or its rooms.',
          },
        ],
        PhotoVerdict
      );
      const payload = verdict
        ? { ...verdict, engine: 'claude-moderator', model: MODEL }
        : {
            action: 'block',
            category: 'refusal',
            reason: 'the model refused to process this content',
            engine: 'claude-moderator',
            model: MODEL,
          };
      const { error } = await supabase.rpc('apply_business_photo_verdict', {
        p_photo_id: photo.id,
        p_verdict: payload,
      });
      if (error) {
        throw new Error(`apply_business_photo_verdict: ${error.message}`);
      }
      if (payload.action === 'allow') {
        report.businessPhotos.approved += 1;
      } else {
        report.businessPhotos.rejected += 1;
      }
    } catch (error) {
      if (isAuthError(error)) {
        return Response.json(
          { error: 'anthropic auth failed — check ANTHROPIC_API_KEY', report },
          { status: 503 }
        );
      }
      report.businessPhotos.failed += 1;
      const attempts = (photo.moderation_attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Fail closed, and say so in the ledger rather than leaving a listing
        // owner staring at a photo step that will never advance.
        const { error: rpcError } = await supabase.rpc('apply_business_photo_verdict', {
          p_photo_id: photo.id,
          p_verdict: {
            action: 'block',
            category: 'moderation_unavailable',
            reason: `classification failed ${attempts} times`,
            engine: 'failsafe',
          },
        });
        report.notes.push(
          rpcError
            ? `business photo ${photo.id}: failsafe reject failed: ${rpcError.message}`
            : `business photo ${photo.id}: failsafe reject after ${attempts} attempts`
        );
      } else {
        const { error: bumpError } = await supabase.rpc('note_business_photo_attempt', {
          p_photo_id: photo.id,
        });
        report.notes.push(
          `business photo ${photo.id}: ${(error as Error).message}` +
            (bumpError ? ` (attempts update failed: ${bumpError.message})` : '')
        );
      }
    }
  }

  // -- 3c. Pending business POST photos ---------------------------------------
  //
  // The same bug as 3b, one table over, and it shipped with the migration that
  // opened the door: 20260902170000 added business_posts.photo_status, a
  // trigger that pins it to 'pending' when require_photo_moderation is on
  // (production does — LAUNCH_RUNBOOK.md:72), and the two doors below. Nothing
  // called them. business_detail returns photo_path only when the status is
  // 'approved' or the reader owns the listing, so every traveler would have
  // got photo_state 'checking' forever, the composer's chip would have read
  // "In review" for good, and moderation_attempts would never move — so it
  // would not even fail closed, it would just hang. The package's own spec
  // says "Do the migration and the worker branch first or do not do the
  // package"; three review lenses found the worker missing.
  //
  // Same shape as 3b, and deliberately the same prompt: a post photo is a
  // photo OF the business, taken by the business, and the question is the same
  // one. Only the sentence beside it changes, because a post is about tonight
  // rather than about the room in general.
  const { data: postPhotos } = await supabase
    .from('business_posts')
    .select('id, business_id, photo_path, moderation_attempts')
    .eq('photo_status', 'pending')
    .not('photo_path', 'is', null)
    .lt('moderation_attempts', MAX_ATTEMPTS)
    .order('created_at')
    .limit(PHOTOS_PER_TICK);

  const hasTimePostPhotos = budgetFor('postPhotos');
  for (const post of postPhotos ?? []) {
    if (!hasTimePostPhotos()) {
      break;
    }
    try {
      const url = await signedUrl('business-photos', post.photo_path as string);
      const verdict = await classify(
        anthropic,
        PROMPTS.photo,
        [
          { type: 'image', source: { type: 'url', url } },
          {
            type: 'text',
            text:
              'Moderate this photo attached to a post by the business that runs it, ' +
              'about something happening there. It should show the place, its food, ' +
              'its drinks, or the thing that is on.',
          },
        ],
        PhotoVerdict
      );
      const payload = verdict
        ? { ...verdict, engine: 'claude-moderator', model: MODEL }
        : {
            action: 'block',
            category: 'refusal',
            reason: 'the model refused to process this content',
            engine: 'claude-moderator',
            model: MODEL,
          };
      const { error } = await supabase.rpc('apply_business_post_photo_verdict', {
        p_post_id: post.id,
        p_verdict: payload,
      });
      if (error) {
        throw new Error(`apply_business_post_photo_verdict: ${error.message}`);
      }
      if (payload.action === 'allow') {
        report.postPhotos.approved += 1;
      } else {
        report.postPhotos.rejected += 1;
      }
    } catch (error) {
      if (isAuthError(error)) {
        return Response.json(
          { error: 'anthropic auth failed — check ANTHROPIC_API_KEY', report },
          { status: 503 }
        );
      }
      report.postPhotos.failed += 1;
      const attempts = (post.moderation_attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Fail closed and say so, rather than leaving an owner watching a chip
        // that will never change.
        const { error: rpcError } = await supabase.rpc('apply_business_post_photo_verdict', {
          p_post_id: post.id,
          p_verdict: {
            action: 'block',
            category: 'moderation_unavailable',
            reason: `classification failed ${attempts} times`,
            engine: 'failsafe',
          },
        });
        report.notes.push(
          rpcError
            ? `post photo ${post.id}: failsafe reject failed: ${rpcError.message}`
            : `post photo ${post.id}: failsafe reject after ${attempts} attempts`
        );
      } else {
        const { error: bumpError } = await supabase.rpc('note_business_post_photo_attempt', {
          p_post_id: post.id,
        });
        report.notes.push(
          `post photo ${post.id}: ${(error as Error).message}` +
            (bumpError ? ` (attempts update failed: ${bumpError.message})` : '')
        );
      }
    }
  }

  // -- 3d. Pending GROUP photos -------------------------------------------------
  //
  // The gap src/features/groups/api.ts recorded: a photo posted INTO a chat
  // is moderated through the messages row it creates, but a group's OWN
  // picture is a column on `groups`, and until 20260903050000 nothing read it
  // before every member did. That migration opened the door below and the
  // counter beside it; this is the worker walking through it. Without this
  // branch, production (flag on) would hold every group photo at 'pending'
  // for ever: my_chats and group_invite_preview mask the path until approved,
  // the bucket refuses to sign it, and the admin watches "Checking this
  // photo" until they give up - and moderation_attempts would never move, so
  // it would not even fail closed.
  //
  // Same classifier and effort as a chat photo: a person is watching a tile
  // on the group page, and the question is the same one. The verdict door
  // takes the group's chat_id AND the path this tick classified: a group is
  // one row, so if the admin replaces the picture while the model is looking
  // at the previous one, the row is pending again for a photo nobody has
  // seen, and a verdict keyed on the chat alone would approve it. The door
  // matches the path and answers false, writing nothing, when the group no
  // longer wears the photo the verdict is about. Every other photo queue is
  // a row per photo and has no such race.
  const { data: groupPhotos } = await supabase
    .from('groups')
    .select('chat_id, photo_path, moderation_attempts')
    .eq('photo_status', 'pending')
    .not('photo_path', 'is', null)
    .lt('moderation_attempts', MAX_ATTEMPTS)
    .order('created_at')
    .limit(PHOTOS_PER_TICK);

  const hasTimeGroupPhotos = budgetFor('groupPhotos');
  for (const group of groupPhotos ?? []) {
    if (!hasTimeGroupPhotos()) {
      break;
    }
    try {
      const url = await signedUrl('chat-photos', group.photo_path as string);
      const verdict = await classify(
        anthropic,
        PROMPTS.photo,
        [
          { type: 'image', source: { type: 'url', url } },
          {
            type: 'text',
            text:
              'Moderate this photo chosen as the picture for a travel group chat. ' +
              'Every member of the group will see it beside the group name.',
          },
        ],
        PhotoVerdict,
        FAST
      );
      const payload = verdict
        ? { ...verdict, engine: 'claude-moderator', model: MODEL }
        : {
            action: 'block',
            category: 'refusal',
            reason: 'the model refused to process this content',
            engine: 'claude-moderator',
            model: MODEL,
          };
      const { data: applied, error } = await supabase.rpc('apply_group_photo_verdict', {
        p_chat_id: group.chat_id,
        p_photo_path: group.photo_path,
        p_verdict: payload,
      });
      if (error) {
        throw new Error(`apply_group_photo_verdict: ${error.message}`);
      }
      if (applied === false) {
        // Replaced or removed while the model looked at it. Not a failure
        // and not an attempt: the photo now on the row is the next tick's.
        report.notes.push(
          `group photo ${group.chat_id}: the group no longer wears the photo this verdict ` +
            'is about; nothing written'
        );
      } else if (payload.action === 'allow') {
        report.groupPhotos.approved += 1;
      } else {
        report.groupPhotos.rejected += 1;
      }
    } catch (error) {
      if (isAuthError(error)) {
        return Response.json(
          { error: 'anthropic auth failed — check ANTHROPIC_API_KEY', report },
          { status: 503 }
        );
      }
      report.groupPhotos.failed += 1;
      const attempts = (group.moderation_attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Fail closed: the photo is removed (not a strike) and the group page
        // tells the admin to pick another, rather than a tile that says
        // "checking" for good.
        // Through the same door with the same path, so a failsafe about the
        // photo that kept failing cannot remove the one that replaced it.
        const { error: rpcError } = await supabase.rpc('apply_group_photo_verdict', {
          p_chat_id: group.chat_id,
          p_photo_path: group.photo_path,
          p_verdict: {
            action: 'block',
            category: 'moderation_unavailable',
            reason: `classification failed ${attempts} times`,
            engine: 'failsafe',
          },
        });
        report.notes.push(
          rpcError
            ? `group photo ${group.chat_id}: failsafe reject failed: ${rpcError.message}`
            : `group photo ${group.chat_id}: failsafe reject after ${attempts} attempts`
        );
      } else {
        const { error: bumpError } = await supabase.rpc('note_group_photo_attempt', {
          p_chat_id: group.chat_id,
        });
        report.notes.push(
          `group photo ${group.chat_id}: ${(error as Error).message}` +
            (bumpError ? ` (attempts update failed: ${bumpError.message})` : '')
        );
      }
    }
  }

  // -- 4. Pending selfie verifications ---------------------------------------
  //
  // The subject's own language, for the two queues that answer a person about
  // themselves. Read as the service role, which holds the table-level grant on
  // profiles; `locale` is granted to no client role at all, so this is the
  // only reader there is besides its owner's write.
  //
  // Every failure here is the same as no locale: a missing row, a null column
  // and a network error all mean English. Silently, and per item rather than
  // once per tick, because a locale lookup that threw would cost the whole
  // queue an item that is otherwise fine.
  const localeOf = async (userId: string | null | undefined): Promise<string | null> => {
    if (!userId) {
      return null;
    }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('locale')
        .eq('user_id', userId)
        .maybeSingle();
      return (data as { locale?: string | null } | null)?.locale ?? null;
    } catch {
      return null;
    }
  };

  const { data: verifications } = await supabase
    .from('verification_requests')
    .select('id, user_id, storage_path, attempts')
    .eq('status', 'pending')
    .order('created_at')
    .limit(VERIFICATIONS_PER_TICK);

  // Data minimization: the selfie has served its purpose the moment a verdict
  // lands — the audit trail lives in the verdict jsonb and moderation_events,
  // never the image. Best-effort delete after every outcome.
  const deleteSelfie = async (path: string) => {
    const { error } = await supabase.storage.from('verification-selfies').remove([path]);
    if (error) {
      report.notes.push(`selfie ${path}: delete failed: ${error.message}`);
    }
  };
  const applyVerificationVerdict = async (id: string, verdict: Record<string, unknown>) => {
    const { error } = await supabase.rpc('apply_verification_verdict', {
      p_request_id: id,
      p_verdict: verdict,
    });
    if (error) {
      throw new Error(`apply_verification_verdict: ${error.message}`);
    }
  };

  const hasTimeVerifications = budgetFor('verifications');
  for (const verification of verifications ?? []) {
    if (!hasTimeVerifications()) {
      break;
    }
    try {
      if ((verification.attempts ?? 0) >= MAX_ATTEMPTS) {
        // The hardcoded failsafes stay English, on purpose, and set reason_en
        // to the same string. A failsafe fires because something already went
        // wrong ten times over; it is not the place to add a translation
        // round trip that can be the eleventh.
        await applyVerificationVerdict(verification.id, {
          action: 'reject',
          reason: 'We could not process your selfie. Please try again.',
          reason_en: 'We could not process your selfie. Please try again.',
          engine: 'failsafe',
        });
        await deleteSelfie(verification.storage_path);
        report.verifications.rejected += 1;
        continue;
      }
      const { data: profilePhotos } = await supabase
        .from('profile_photos')
        .select('id, storage_path')
        .eq('user_id', verification.user_id)
        .eq('moderation_status', 'approved')
        .order('position')
        .limit(2);
      if (!profilePhotos || profilePhotos.length === 0) {
        // No longer a race guard: submit_verification admits a PENDING photo
        // (20260904100000), so this is the ordinary state of a selfie taken
        // seconds after the photo went up, which is what signup does. Photos
        // are drained earlier in this same tick (QUEUE_BUDGET_MS order), so
        // by the next one the photo has usually cleared. Leave the request
        // exactly as it is - not rejected, no attempt spent - and say so in
        // the report. Only a request with no approved AND no pending photo
        // can never be judged, and that one is rejected as before.
        const { data: pendingPhotos } = await supabase
          .from('profile_photos')
          .select('id')
          .eq('user_id', verification.user_id)
          .eq('moderation_status', 'pending')
          .limit(1);
        if (pendingPhotos && pendingPhotos.length > 0) {
          report.verifications.waiting += 1;
          continue;
        }
        await applyVerificationVerdict(verification.id, {
          action: 'reject',
          reason: 'Add at least one profile photo before verifying.',
          reason_en: 'Add at least one profile photo before verifying.',
          engine: 'claude-verifier-precheck',
        });
        await deleteSelfie(verification.storage_path);
        report.verifications.rejected += 1;
        continue;
      }
      // Which photos were in the prompt, recorded on the verdict so the badge
      // remembers the face it was issued for. What was actually SENT, rather
      // than what the database would re-derive at verdict time: the two can
      // differ by the length of a model call. apply_verification_verdict
      // falls back to its own derivation for a verdict from an older worker
      // that sends none.
      const photoIds = profilePhotos.map((p: any) => p.id as string);

      const selfieUrl = await signedUrl('verification-selfies', verification.storage_path);
      const photoUrls = await Promise.all(
        profilePhotos.map((p: any) => signedUrl('profile-photos', p.storage_path))
      );
      const content: Anthropic.MessageParam['content'] = [
        { type: 'text', text: 'SELFIE:' },
        { type: 'image', source: { type: 'url', url: selfieUrl } },
        ...photoUrls.flatMap((url, index): Anthropic.ContentBlockParam[] => [
          { type: 'text', text: `PROFILE PHOTO ${index + 1}:` },
          { type: 'image', source: { type: 'url', url } },
        ]),
        { type: 'text', text: 'Is this selfie plausibly the same person as the profile photos?' },
        // A refusal about somebody's own face, in a sentence they can read.
        { type: 'text', text: languageLine(await localeOf(verification.user_id)) },
      ];
      const verdict = await classify(anthropic, PROMPTS.verification, content, VerificationVerdict);
      const payload = verdict
        ? { ...verdict, engine: 'claude-verifier', model: MODEL, photo_ids: photoIds }
        : {
            action: 'reject',
            reason: 'We could not review this selfie. Please try a different photo.',
            reason_en: 'We could not review this selfie. Please try a different photo.',
            engine: 'claude-verifier',
            model: MODEL,
            photo_ids: photoIds,
          };
      await applyVerificationVerdict(verification.id, payload);
      await deleteSelfie(verification.storage_path);
      if (payload.action === 'approve') {
        report.verifications.approved += 1;
      } else {
        report.verifications.rejected += 1;
      }
    } catch (error) {
      if (isAuthError(error)) {
        return Response.json(
          { error: 'anthropic auth failed — check ANTHROPIC_API_KEY', report },
          { status: 503 }
        );
      }
      report.verifications.failed += 1;
      const { error: bumpError } = await supabase
        .from('verification_requests')
        .update({ attempts: (verification.attempts ?? 0) + 1 })
        .eq('id', verification.id);
      report.notes.push(
        `verification ${verification.id}: ${(error as Error).message}` +
          (bumpError ? ` (attempts update failed: ${bumpError.message})` : '')
      );
    }
  }

  // -- 5. Storefront photos: the check the verified badge actually means ------
  //
  // Modelled on the selfie branch with two deliberate departures. Two images
  // instead of one, because a close-up of a sign is the easiest thing on
  // earth to find online and a wide shot pins that sign to a building and a
  // street. And the evidence is NOT deleted afterwards: a traveler appeals
  // nothing, but a refused business is told to write in, and the founder
  // cannot judge an appeal against a photo that no longer exists.
  const storefrontPrompt = optionalPrompt('storefront');
  if (!storefrontPrompt) {
    report.notes.push('storefront: no prompt in MODERATION_PROMPTS_BUSINESS, queue paused');
  } else {
    const { data: storefronts } = await supabase
      .from('business_verifications')
      .select('id, business_id, wide_path, close_path, attempts')
      .eq('status', 'pending')
      .order('created_at')
      .limit(STOREFRONTS_PER_TICK);

    const applyStorefront = async (id: string, verdict: Record<string, unknown>) => {
      const { error } = await supabase.rpc('apply_business_verification_verdict', {
        p_request_id: id,
        p_verdict: verdict,
      });
      if (error) {
        throw new Error(`apply_business_verification_verdict: ${error.message}`);
      }
    };

    const hasTimeStorefronts = budgetFor('storefronts');
    for (const check of storefronts ?? []) {
      if (!hasTimeStorefronts()) {
        break;
      }
      try {
        if ((check.attempts ?? 0) >= MAX_ATTEMPTS) {
          // English, and reason_en the same string — see the selfie failsafe.
          await applyStorefront(check.id, {
            action: 'reject',
            reason: 'We could not process those photos. Have another go.',
            reason_en: 'We could not process those photos. Have another go.',
            engine: 'failsafe',
          });
          report.storefronts.rejected += 1;
          continue;
        }

        const { data: business } = await supabase
          .from('businesses')
          .select('name, category, place_label, city_id, owner_user_id')
          .eq('id', check.business_id)
          .maybeSingle();
        const { data: city } = business
          ? await supabase
              .from('cities')
              .select('name, country_code')
              .eq('id', business.city_id)
              .maybeSingle()
          : { data: null };

        const wideUrl = await signedUrl('business-verification', check.wide_path);
        const closeUrl = await signedUrl('business-verification', check.close_path);
        const claim = [
          `CLAIMED NAME: ${business?.name ?? '(unknown)'}`,
          `CLAIMED CATEGORY: ${business?.category ?? '(unknown)'}`,
          `CLAIMED CITY: ${city ? `${city.name}, ${city.country_code}` : '(unknown)'}`,
          business?.place_label ? `THE BUSINESS SAYS: ${business.place_label}` : null,
        ]
          .filter(Boolean)
          .join('\n');

        const content: Anthropic.MessageParam['content'] = [
          { type: 'text', text: claim },
          { type: 'text', text: 'WIDE SHOT, from across the street:' },
          { type: 'image', source: { type: 'url', url: wideUrl } },
          { type: 'text', text: 'CLOSE SHOT, near enough to read the sign:' },
          { type: 'image', source: { type: 'url', url: closeUrl } },
          {
            type: 'text',
            text:
              'Are both of these real photographs of a real premises rather than ' +
              'screenshots, photos of a screen, stock images or renders? Do they show ' +
              'the SAME premises? Does signage in the close shot read the claimed name, ' +
              'allowing for translation, transliteration and a trading name that differs ' +
              'from the legal one? Does the storefront look like the claimed category? ' +
              'Does the wide shot plausibly match the claimed city?',
          },
          // A refusal about somebody's livelihood, in a sentence they can
          // read. The OWNER's locale, not the business's: a business has no
          // language, a person does.
          { type: 'text', text: languageLine(await localeOf(business?.owner_user_id)) },
        ];

        const verdict = await classify(anthropic, storefrontPrompt, content, StorefrontVerdict);
        // A model refusal on a photo of a shopfront is strange enough that a
        // human should look, rather than either side of it being assumed.
        const payload = verdict
          ? { ...verdict, engine: 'claude-storefront', model: MODEL }
          : {
              action: 'uncertain',
              reason: 'We could not review those photos automatically.',
              reason_en: 'We could not review those photos automatically.',
              engine: 'claude-storefront',
              model: MODEL,
            };
        await applyStorefront(check.id, payload);
        if (payload.action === 'approve') {
          report.storefronts.approved += 1;
        } else if (payload.action === 'uncertain') {
          report.storefronts.uncertain += 1;
        } else {
          report.storefronts.rejected += 1;
        }
      } catch (error) {
        if (isAuthError(error)) {
          return Response.json(
            { error: 'anthropic auth failed — check ANTHROPIC_API_KEY', report },
            { status: 503 }
          );
        }
        report.storefronts.failed += 1;
        const { error: bumpError } = await supabase
          .from('business_verifications')
          .update({ attempts: (check.attempts ?? 0) + 1 })
          .eq('id', check.id);
        report.notes.push(
          `storefront ${check.id}: ${(error as Error).message}` +
            (bumpError ? ` (attempts update failed: ${bumpError.message})` : '')
        );
      }
    }
  }

  // -- 6. Impersonation scans, on the first report ---------------------------
  //
  // **[founder]** the scan runs on the FIRST report rather than the third.
  // Nothing here darkens a listing on its own: the RPC does that, and only on
  // a plausible-impersonation verdict, which is what keeps a competitor with
  // one spare account from being able to take a rival down.
  const impersonationPrompt = optionalPrompt('impersonation');
  if (!impersonationPrompt) {
    report.notes.push('impersonation: no prompt in MODERATION_PROMPTS_BUSINESS, queue paused');
  } else {
    const { data: scans } = await supabase
      .from('business_scans')
      .select('id, business_id, trigger_report_id, attempts')
      .eq('status', 'pending')
      .order('created_at')
      .limit(SCANS_PER_TICK);

    const hasTimeScans = budgetFor('scans');
    for (const scan of scans ?? []) {
      if (!hasTimeScans()) {
        break;
      }
      try {
        if ((scan.attempts ?? 0) >= MAX_ATTEMPTS) {
          // Fail OPEN here, and only here. Everything else in this worker
          // fails closed, but a scan that cannot run is not evidence of
          // anything, and darkening a real business because the classifier
          // was down would be the app doing the damage it exists to prevent.
          // The report is already in the founder's inbox.
          await supabase.rpc('apply_business_scan_verdict', {
            p_scan_id: scan.id,
            p_verdict: {
              impersonation_plausible: false,
              reason: 'The check could not run. Left for a person to look at.',
              engine: 'failsafe',
            },
          });
          report.scans.cleared += 1;
          continue;
        }

        const { data: business } = await supabase
          .from('businesses')
          .select('name, category, description, place_label, website_url, city_id')
          .eq('id', scan.business_id)
          .maybeSingle();
        const { data: city } = business
          ? await supabase
              .from('cities')
              .select('name, country_code')
              .eq('id', business.city_id)
              .maybeSingle()
          : { data: null };
        const { data: report_row } = scan.trigger_report_id
          ? await supabase
              .from('business_reports')
              .select('reason, note')
              .eq('id', scan.trigger_report_id)
              .maybeSingle()
          : { data: null };
        const { data: links } = await supabase
          .from('business_links')
          .select('kind, label, value')
          .eq('business_id', scan.business_id)
          .limit(10);
        const { data: posts } = await supabase
          .from('business_posts')
          .select('title, body')
          .eq('business_id', scan.business_id)
          .is('archived_at', null)
          .limit(10);

        const listing = [
          `NAME: ${business?.name ?? '(unknown)'}`,
          `CATEGORY: ${business?.category ?? '(unknown)'}`,
          `CITY: ${city ? `${city.name}, ${city.country_code}` : '(unknown)'}`,
          `DESCRIPTION: ${business?.description ?? '(none)'}`,
          `DIRECTIONS: ${business?.place_label ?? '(none)'}`,
          `WEBSITE: ${business?.website_url ?? '(none)'}`,
          `LINKS: ${(links ?? []).map((l: any) => `${l.kind} "${l.label}" ${l.value}`).join(' | ') || '(none)'}`,
          `POSTS: ${(posts ?? []).map((p: any) => `${p.title}: ${p.body ?? ''}`).join(' | ') || '(none)'}`,
          '',
          `SOMEBODY REPORTED IT AS: ${report_row?.reason ?? '(unknown)'}`,
          `THEY SAID: ${report_row?.note ?? '(nothing)'}`,
        ].join('\n');

        const verdict = await classify(
          anthropic,
          impersonationPrompt,
          [
            { type: 'text', text: listing },
            {
              type: 'text',
              text:
                'Is it plausible that this listing is pretending to be a business it ' +
                'is not, or is otherwise not the real thing? Weigh the report, but do ' +
                'not treat it as evidence on its own: a competitor can file one.',
            },
          ],
          ImpersonationVerdict
        );
        const payload = verdict
          ? { ...verdict, engine: 'claude-impersonation', model: MODEL }
          : {
              impersonation_plausible: false,
              reason: 'The model would not answer. Left for a person to look at.',
              engine: 'claude-impersonation',
              model: MODEL,
            };
        const { error: applyError } = await supabase.rpc('apply_business_scan_verdict', {
          p_scan_id: scan.id,
          p_verdict: payload,
        });
        if (applyError) {
          throw new Error(`apply_business_scan_verdict: ${applyError.message}`);
        }
        if (payload.impersonation_plausible) {
          report.scans.flagged += 1;
        } else {
          report.scans.cleared += 1;
        }
      } catch (error) {
        if (isAuthError(error)) {
          return Response.json(
            { error: 'anthropic auth failed — check ANTHROPIC_API_KEY', report },
            { status: 503 }
          );
        }
        report.scans.failed += 1;
        const { error: bumpError } = await supabase
          .from('business_scans')
          .update({ attempts: (scan.attempts ?? 0) + 1 })
          .eq('id', scan.id);
        report.notes.push(
          `scan ${scan.id}: ${(error as Error).message}` +
            (bumpError ? ` (attempts update failed: ${bumpError.message})` : '')
        );
      }
    }
  }

  return Response.json(report);
});
