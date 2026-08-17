// Claude moderation worker (Phase 5). Drains three server-side queues:
//
//   1. message_requests in 'pending_moderation'  -> apply_message_verdict
//   2. profile_photos   in 'pending'             -> apply_photo_verdict
//   3. verification_requests in 'pending'        -> apply_verification_verdict
//
// Deploy:   supabase functions deploy moderation-worker
// Secrets:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
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

[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]

[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]
[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]
[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]
[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]
[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]
[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]

[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]

[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]

[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]

[redacted — the classifier prompt lives in the MODERATION_PROMPTS function secret]

type WorkerReport = {
  messages: { approved: number; blocked: number; failed: number };
  photos: { approved: number; rejected: number; failed: number };
  verifications: { approved: number; rejected: number; failed: number };
  notes: string[];
};

// Classifies with structured output; returns the parsed verdict or throws.
// A refusal stop reason returns null so callers can map it to a block.
async function classify<T>(
  anthropic: Anthropic,
  system: string,
  content: Anthropic.MessageParam['content'],
  schema: z.ZodType<T>
): Promise<T | null> {
  const response = await anthropic.messages.parse({
    model: MODEL,
    // Opus 5 thinks adaptively by default and thinking tokens count against
    // max_tokens — generous headroom keeps a long think from truncating the
    // verdict (which would read as a classification failure).
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(schema) },
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

Deno.serve(async () => {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY secret is not set; queues left untouched' },
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
    verifications: { approved: 0, rejected: 0, failed: 0 },
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

  // -- 1. Held first messages -------------------------------------------------
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
        MESSAGE_SYSTEM,
        [
          {
            type: 'text',
            text:
              `Profile element the sender is replying to: ${request.profile_element ?? 'none'}\n` +
              `Request source: ${request.source}\n` +
              `First message:\n${request.first_message}`,
          },
        ],
        MessageVerdict
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

  // -- 2. Pending photos ------------------------------------------------------
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
        PHOTO_SYSTEM,
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

  // -- 3. Pending selfie verifications ---------------------------------------
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
      const verdict = await classify(anthropic, VERIFICATION_SYSTEM, content, VerificationVerdict);
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

  return Response.json(report);
});
