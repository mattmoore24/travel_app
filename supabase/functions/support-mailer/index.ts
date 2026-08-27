// Emails whatever is waiting to go out: the in-app contact form, and the
// business queue (confirmation codes, report alerts, verification outcomes).
//
// Deploy:  supabase functions deploy support-mailer
// Schedule: pg_cron every five minutes (see the support_messages migration).
//
// Secrets, both set with `supabase secrets set`:
//   RESEND_API_KEY   a Resend key with send permission
//   SUPPORT_INBOX    where support mail should land
//   SUPPORT_FROM     optional; the verified sender, defaults to Resend's
//                    shared onboarding@resend.dev sandbox address
//
// With either of the first two missing this returns quietly and changes
// nothing. That is deliberate: the rows are the record and they keep piling
// up safely in the table, readable from the dashboard, until somebody
// supplies a key. A worker that failed loudly every five minutes on a
// project that has not been configured yet would just train everyone to
// ignore its logs.
//
// Runs with the service role: support_messages has no select policy at all,
// so nothing but the service role can read it.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_URL = 'https://api.resend.com/emails';
const BATCH = 25;

/** Give up after this many tries so one poisoned row cannot block the queue. */
const MAX_ATTEMPTS = 20;

/**
 * How long to wait before trying a failed row again, doubling each time and
 * capped at six hours.
 *
 * Five attempts on a five-minute tick meant a row was abandoned permanently
 * twenty-five minutes after it arrived. On 2026-08-21 a wrong API key and
 * then a sandbox sender rule used up every attempt on two real messages
 * before anybody had read the error, and nothing was ever going to retry
 * them. Spacing turns the same handful of attempts into several days, which
 * is the timescale a person actually fixes configuration on.
 */
function backoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(attempts - 1, 0), 360);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const inbox = Deno.env.get('SUPPORT_INBOX');
  const from = Deno.env.get('SUPPORT_FROM') ?? 'Samewhere <onboarding@resend.dev>';

  if (!apiKey || !inbox) {
    return Response.json({
      skipped: 'not configured',
      missing: [!apiKey ? 'RESEND_API_KEY' : null, !inbox ? 'SUPPORT_INBOX' : null].filter(Boolean),
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: pending, error } = await supabase
    .from('support_messages')
    .select('id, user_id, reply_to, body, created_at, delivery_attempts')
    .is('delivered_at', null)
    .lt('delivery_attempts', MAX_ATTEMPTS)
    // Only what is due. A row that just failed waits out its backoff instead
    // of burning another attempt on the next tick.
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at')
    .limit(BATCH);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const report = { delivered: 0, failed: 0, notes: [] as string[] };

  // Not an early return when this queue is empty: the business queue below
  // has its own rows, and an empty contact form used to mean nothing else
  // got sent either.
  for (const message of (pending ?? []) as any[]) {
    const who = message.user_id ? `account ${message.user_id}` : 'a guest';
    try {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [inbox],
          // Replying in a mail client should reach the person who wrote in,
          // which is the whole point of asking for their address.
          reply_to: message.reply_to,
          subject: `Samewhere support: ${message.reply_to}`,
          text: [
            `From: ${message.reply_to} (${who})`,
            `Sent: ${message.created_at}`,
            '',
            message.body,
          ].join('\n'),
          html:
            `<p><strong>From:</strong> ${escapeHtml(message.reply_to)} (${escapeHtml(who)})<br>` +
            `<strong>Sent:</strong> ${escapeHtml(message.created_at)}</p>` +
            `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(message.body)}</pre>`,
        }),
      });

      if (!response.ok) {
        throw new Error(`resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }

      const { error: markError } = await supabase
        .from('support_messages')
        .update({
          delivered_at: new Date().toISOString(),
          delivery_attempts: (message.delivery_attempts ?? 0) + 1,
          delivery_error: null,
        })
        .eq('id', message.id);
      if (markError) {
        // The mail went out. Say so loudly, because the row will be picked up
        // again on the next tick and the founder will get it twice.
        report.notes.push(`${message.id}: sent but not marked: ${markError.message}`);
      }
      report.delivered += 1;
    } catch (sendError) {
      report.failed += 1;
      const attempts = (message.delivery_attempts ?? 0) + 1;
      const detail = (sendError as Error).message.slice(0, 500);
      const wait = backoffMinutes(attempts);
      await supabase
        .from('support_messages')
        .update({
          delivery_attempts: attempts,
          delivery_error: detail,
          next_attempt_at: new Date(Date.now() + wait * 60_000).toISOString(),
        })
        .eq('id', message.id);
      report.notes.push(
        attempts >= MAX_ATTEMPTS
          ? `${message.id}: giving up after ${attempts} attempts (${detail}). The row is still in the table.`
          : `${message.id}: ${detail} — next try in ${wait}m`
      );
    }
  }

  const mail = await drainOutboundMail(supabase, { apiKey, from, inbox });
  return Response.json({ ...report, mail });
});

/**
 * The second queue: public.outbound_mail.
 *
 * Kept as its own pass rather than folded into the loop above, because the
 * contact form has been running against real traffic since August and a
 * business email is not worth the risk of touching it. Same backoff, same
 * give-up rule, same "the row is the record" posture.
 *
 * `to_address` NULL means the support inbox. That indirection is why the
 * founder's own address is nowhere in the database: the destination is a
 * secret, substituted here at send time.
 */
async function drainOutboundMail(
  supabase: any,
  config: { apiKey: string; from: string; inbox: string }
) {
  const { data: pending, error } = await supabase
    .from('outbound_mail')
    .select('id, to_address, subject, text_body, kind, created_at, delivery_attempts')
    .is('delivered_at', null)
    .lt('delivery_attempts', MAX_ATTEMPTS)
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at')
    .limit(BATCH);
  if (error) {
    return { error: error.message };
  }
  if (!pending || pending.length === 0) {
    return { delivered: 0 };
  }

  const report = { delivered: 0, failed: 0, notes: [] as string[] };

  for (const item of pending as any[]) {
    const to = item.to_address ?? config.inbox;
    try {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.from,
          to: [to],
          subject: item.subject,
          text: item.text_body,
          html: `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(item.text_body)}</pre>`,
        }),
      });
      if (!response.ok) {
        throw new Error(`resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }
      const { error: markError } = await supabase
        .from('outbound_mail')
        .update({
          delivered_at: new Date().toISOString(),
          delivery_attempts: (item.delivery_attempts ?? 0) + 1,
          delivery_error: null,
        })
        .eq('id', item.id);
      if (markError) {
        // It went out. Say so loudly: the row comes back on the next tick and
        // somebody gets the same code twice.
        report.notes.push(`${item.id}: sent but not marked: ${markError.message}`);
      }
      report.delivered += 1;
    } catch (sendError) {
      report.failed += 1;
      const attempts = (item.delivery_attempts ?? 0) + 1;
      const detail = (sendError as Error).message.slice(0, 500);
      const wait = backoffMinutes(attempts);
      await supabase
        .from('outbound_mail')
        .update({
          delivery_attempts: attempts,
          delivery_error: detail,
          next_attempt_at: new Date(Date.now() + wait * 60_000).toISOString(),
        })
        .eq('id', item.id);
      report.notes.push(
        attempts >= MAX_ATTEMPTS
          ? `${item.id} (${item.kind}): giving up after ${attempts} attempts (${detail}).`
          : `${item.id} (${item.kind}): ${detail} — next try in ${wait}m`
      );
    }
  }

  return report;
}
