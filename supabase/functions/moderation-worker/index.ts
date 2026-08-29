// Claude moderation worker. Drains six server-side queues:
//
//   1. message_requests in 'pending_moderation'  -> apply_message_verdict
//   2. profile_photos   in 'pending'             -> apply_photo_verdict
//   2b. business_photos in 'pending'             -> apply_business_photo_verdict
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
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';
import { z } from 'npm:zod';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk/helpers/zod';

const MODEL = 'claude-opus-5';
const MAX_ATTEMPTS = 10;
const MESSAGES_PER_TICK = 10;
const PHOTOS_PER_TICK = 5;
const VERIFICATIONS_PER_TICK = 3;
const CHAT_PHOTOS_PER_TICK = 8;
const STOREFRONTS_PER_TICK = 3;
const SCANS_PER_TICK = 3;
const SIGNED_URL_TTL_SECONDS = 600;

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
  // User-facing when rejecting ("the selfie is too dark to compare").
  reason: z.string(),
});

// Three outcomes, not two. 'uncertain' exists because a hand-painted sign in
// a script the model reads poorly is a real business having a bad day, and
// refusing it outright would be this app being confidently wrong about
// somebody's livelihood. Uncertain goes to the founder.
const StorefrontVerdict = z.object({
  action: z.enum(['approve', 'reject', 'uncertain']),
  confidence: z.number(),
  // User-facing on a reject: what to do differently, never an accusation.
  reason: z.string(),
});

const ImpersonationVerdict = z.object({
  impersonation_plausible: z.boolean(),
  confidence: z.number(),
  reason: z.string(),
});

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
  chatPhotos: { approved: number; rejected: number; failed: number };
  verifications: { approved: number; rejected: number; failed: number };
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
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const report: WorkerReport = {
    messages: { approved: 0, blocked: 0, failed: 0 },
    photos: { approved: 0, rejected: 0, failed: 0 },
    businessPhotos: { approved: 0, rejected: 0, failed: 0 },
    chatPhotos: { approved: 0, rejected: 0, failed: 0 },
    verifications: { approved: 0, rejected: 0, failed: 0 },
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

  for (const photo of chatPhotos ?? []) {
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

  for (const request of held ?? []) {
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

  for (const photo of photos ?? []) {
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

  for (const photo of businessPhotos ?? []) {
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

  // -- 4. Pending selfie verifications ---------------------------------------
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

  for (const verification of verifications ?? []) {
    try {
      if ((verification.attempts ?? 0) >= MAX_ATTEMPTS) {
        await applyVerificationVerdict(verification.id, {
          action: 'reject',
          reason: 'We could not process your selfie. Please try again.',
          engine: 'failsafe',
        });
        await deleteSelfie(verification.storage_path);
        report.verifications.rejected += 1;
        continue;
      }
      const { data: profilePhotos } = await supabase
        .from('profile_photos')
        .select('storage_path')
        .eq('user_id', verification.user_id)
        .eq('moderation_status', 'approved')
        .order('position')
        .limit(2);
      if (!profilePhotos || profilePhotos.length === 0) {
        // Race guard only — submit_verification requires an approved photo.
        await applyVerificationVerdict(verification.id, {
          action: 'reject',
          reason: 'Add at least one profile photo before verifying.',
          engine: 'claude-verifier-precheck',
        });
        await deleteSelfie(verification.storage_path);
        report.verifications.rejected += 1;
        continue;
      }

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
      ];
      const verdict = await classify(anthropic, PROMPTS.verification, content, VerificationVerdict);
      const payload = verdict
        ? { ...verdict, engine: 'claude-verifier', model: MODEL }
        : {
            action: 'reject',
            reason: 'We could not review this selfie. Please try a different photo.',
            engine: 'claude-verifier',
            model: MODEL,
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

    for (const check of storefronts ?? []) {
      try {
        if ((check.attempts ?? 0) >= MAX_ATTEMPTS) {
          await applyStorefront(check.id, {
            action: 'reject',
            reason: 'We could not process those photos. Have another go.',
            engine: 'failsafe',
          });
          report.storefronts.rejected += 1;
          continue;
        }

        const { data: business } = await supabase
          .from('businesses')
          .select('name, category, place_label, city_id')
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
        ];

        const verdict = await classify(anthropic, storefrontPrompt, content, StorefrontVerdict);
        // A model refusal on a photo of a shopfront is strange enough that a
        // human should look, rather than either side of it being assumed.
        const payload = verdict
          ? { ...verdict, engine: 'claude-storefront', model: MODEL }
          : {
              action: 'uncertain',
              reason: 'We could not review those photos automatically.',
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

    for (const scan of scans ?? []) {
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
