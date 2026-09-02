// Drains public.push_queue and delivers via the Expo push API.
//
// Deploy:  supabase functions deploy push-worker
// Schedule (Supabase Dashboard -> Edge Functions -> Schedules, or pg_cron +
// pg_net): every minute is plenty at v1 scale.
//
// Runs with the service role (queue and tokens are server-only tables).
//
// WHAT `sent_at` MEANS, because until 2026-09-02 it meant less than it said.
// This worker read one thing off an Expo push ticket - whether it said
// DeviceNotRegistered, in which case the token was pruned - and stamped every
// row sent_at regardless. So InvalidCredentials (no APNs key on EAS),
// MessageTooBig, MessageRateExceeded and a request-level error with no
// tickets at all were each dropped on the floor and recorded as a delivery.
// The exact wall the founder is about to walk into with the 0.2.0 build
// (docs/APP_STORE.md, "The APNs entitlement"): a perfect entitlement and no
// key, registration succeeds, nothing arrives, the queue drains, every check
// green.
//
// Now `sent_at` means "this worker is finished with the row", and it becomes
// finished in exactly three ways: Expo accepted every notification the row
// produced; the recipient has no token to send to (the queue tracks intent,
// not deliverability); or the row has been refused MAX_ATTEMPTS times and the
// worker gives up, leaving `last_error` beside the stamp to say so. A row
// refused fewer times than that keeps sent_at NULL, carries `attempts` and
// `last_error` (20260903120000), and is picked up again next tick - which is
// also the first time admin_ops_health's unsent count has been able to see a
// push that is not going. Every refusal is counted by name in this tick's
// report and written to the function log.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100;

// Ten ticks, one a minute. The same number the moderation worker gives an
// item before its failsafe, and the right order of magnitude for a push: a
// MessageRateExceeded clears in seconds, and a push about a message that
// arrived ten minutes ago is already stale enough that retrying it further
// would be noise on the lock screen rather than news. InvalidCredentials will
// still be InvalidCredentials in ten minutes; giving up is what keeps the
// queue from growing without bound while the key is missing, and the
// last_error left behind is what says the key was missing.
const MAX_ATTEMPTS = 10;

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

/** One notification, and the queue row it was made from. */
type Outgoing = { rowId: number; message: Record<string, unknown> };

/**
 * What the tickets say about the rows that produced them, accumulated across
 * every chunk of one tick.
 */
type Triage = {
  /** Tokens Expo says are gone for good. Pruned; the row is still finished. */
  invalidTokens: string[];
  /** Row id -> the name of the error that refused it. Anything else. */
  refused: Map<number, string>;
  /** Every refusal, counted by name, for the report and the log. */
  errors: Record<string, number>;
};

/**
 * Read every ticket, not one of them.
 *
 * Expo answers one ticket per notification, in order (their docs; the shape
 * is `{ status: 'ok', id }` or `{ status: 'error', message, details?: {
 * error?: <name> } }`). DeviceNotRegistered is the one error that is about
 * the TOKEN rather than the send - the device uninstalled or revoked - so it
 * prunes the token and the row counts as finished. Every other error is a
 * send that did not happen, named by `details.error` when Expo gives a name
 * and by the message when it does not, and the row that produced it is not
 * finished.
 *
 * A ticket that is simply missing - fewer tickets than notifications - is a
 * refusal too. The old code's `forEach` over the tickets would have skipped
 * the notifications past the end and stamped their rows sent.
 */
function triageTickets(tickets: any[], chunk: Outgoing[], into: Triage) {
  chunk.forEach((outgoing, j) => {
    const ticket = tickets[j];
    if (ticket?.status === 'ok') {
      return;
    }
    const detail = ticket?.details?.error;
    if (detail === 'DeviceNotRegistered') {
      into.invalidTokens.push(outgoing.message.to as string);
      return;
    }
    const name =
      typeof detail === 'string' && detail.length > 0
        ? detail
        : ticket == null
          ? 'NoTicket'
          : typeof ticket.message === 'string' && ticket.message.length > 0
            ? ticket.message.slice(0, 80)
            : 'UnknownTicketError';
    into.errors[name] = (into.errors[name] ?? 0) + 1;
    into.refused.set(outgoing.rowId, name);
  });
}

Deno.serve(async (req) => {
  if (!isServiceCaller(req)) {
    return refuse();
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: queued, error } = await supabase
    .from('push_queue')
    .select('id, user_id, title, body, data, attempts')
    .is('sent_at', null)
    .order('id')
    .limit(BATCH);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!queued || queued.length === 0) {
    return Response.json({ delivered: 0 });
  }

  const userIds = [...new Set(queued.map((q: any) => q.user_id))];
  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('user_id, token')
    .in('user_id', userIds);
  // The number for the home-screen icon, computed once for the whole batch.
  // Deliberately NOT a column on push_queue: a value written at enqueue time
  // is stale by the time the row drains, and it would need populating at
  // every one of the thirty-odd places that write to the queue. One round
  // trip per drain, always current.
  //
  // A failure here is not a reason to drop a notification: the badge is the
  // sidecar, the banner is the message. Missing counts simply mean no badge
  // on this batch.
  const { data: waiting } = await supabase.rpc('waiting_counts', { p_users: userIds });
  const waitingByUser = new Map<string, number>(
    (waiting ?? []).map((row: any) => [row.user_id as string, row.waiting as number])
  );
  const tokensByUser = new Map<string, string[]>();
  for (const row of tokens ?? []) {
    tokensByUser.set(row.user_id, [...(tokensByUser.get(row.user_id) ?? []), row.token]);
  }

  // Each notification remembers the row it came from, because a ticket is
  // answered per notification and the bookkeeping is per row.
  const notifications: Outgoing[] = queued.flatMap((item: any) =>
    (tokensByUser.get(item.user_id) ?? []).map((to: string) => ({
      rowId: item.id as number,
      message: {
        to,
        title: item.title,
        body: item.body,
        data: item.data,
        sound: 'default',
        badge: waitingByUser.get(item.user_id) ?? undefined,
      },
    }))
  );

  // Expo's push API caps 100 notifications per request; a batch of queue
  // rows can exceed that when recipients have multiple devices. Chunk, and
  // if any request fails outright, bail WITHOUT stamping sent_at so the
  // whole batch retries next tick.
  const triage: Triage = { invalidTokens: [], refused: new Map(), errors: {} };
  for (let i = 0; i < notifications.length; i += 100) {
    const chunk = notifications.slice(i, i + 100);
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chunk.map((n) => n.message)),
    });
    if (!response.ok) {
      return Response.json(
        { error: `expo push ${response.status}`, delivered: i },
        { status: 502 }
      );
    }
    const result = await response.json().catch(() => null);
    // A 200 with no tickets in it is a request-level refusal (Expo puts it in
    // `errors`, e.g. PUSH_TOO_MANY_EXPERIENCE_IDS), and it used to read as
    // "no tickets to inspect" and stamp the whole chunk sent. Every row in
    // the chunk is refused, under the name Expo gave or a name that says
    // there was none.
    if (!Array.isArray(result?.data)) {
      const name =
        typeof result?.errors?.[0]?.code === 'string' ? result.errors[0].code : 'NoTickets';
      for (const outgoing of chunk) {
        triage.errors[name] = (triage.errors[name] ?? 0) + 1;
        triage.refused.set(outgoing.rowId, name);
      }
      continue;
    }
    triageTickets(result.data, chunk, triage);
  }

  // Said out loud, once per error name, so a tick whose every send was
  // refused reads as such in the function log rather than as a quiet
  // `delivered: 0`.
  for (const [name, count] of Object.entries(triage.errors)) {
    console.error(`push-worker: ${count} notification(s) refused by Expo: ${name}`);
  }

  if (triage.invalidTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', triage.invalidTokens);
  }

  // -- write back -------------------------------------------------------------
  //
  // A row goes out when no notification it produced was refused; that covers
  // a recipient with no tokens at all (nothing to refuse) and one whose only
  // token was DeviceNotRegistered (pruned, and no way to reach them). A row
  // with one device accepted and another refused is retried whole, which can
  // repeat the push on the device that took it: a duplicate banner is the
  // cheaper of the two mistakes, and the errors that actually happen here
  // (no APNs key, a bad message) refuse every device alike.
  const now = new Date().toISOString();
  const delivered = queued
    .filter((q: any) => !triage.refused.has(q.id))
    .map((q: any) => q.id as number);
  if (delivered.length > 0) {
    await supabase
      .from('push_queue')
      .update({ sent_at: now, last_error: null })
      .in('id', delivered);
  }

  const retried: number[] = [];
  const gaveUp: number[] = [];
  for (const item of queued as any[]) {
    const name = triage.refused.get(item.id);
    if (name == null) {
      continue;
    }
    const attempts = (item.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      // The failsafe. Finished with, and the error kept beside the stamp so
      // "sent_at set, last_error set" reads as "given up", never as "sent".
      await supabase
        .from('push_queue')
        .update({ sent_at: now, attempts, last_error: name })
        .eq('id', item.id);
      gaveUp.push(item.id);
      console.error(
        `push-worker: gave up on push_queue row ${item.id} after ${attempts} attempts: ${name}`
      );
    } else {
      // Left for the next tick, with the count and the reason.
      await supabase.from('push_queue').update({ attempts, last_error: name }).eq('id', item.id);
      retried.push(item.id);
    }
  }

  return Response.json({
    delivered: notifications.length - triage.refused.size,
    pruned: triage.invalidTokens.length,
    retried: retried.length,
    gave_up: gaveUp.length,
    errors: triage.errors,
  });
});
