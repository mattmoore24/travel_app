// Drains public.push_queue and delivers via the Expo push API.
//
// Deploy:  supabase functions deploy push-worker
// Schedule (Supabase Dashboard -> Edge Functions -> Schedules, or pg_cron +
// pg_net): every minute is plenty at v1 scale.
//
// Runs with the service role (queue and tokens are server-only tables).
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100;

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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: queued, error } = await supabase
    .from('push_queue')
    .select('id, user_id, title, body, data')
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

  const notifications = queued.flatMap((item: any) =>
    (tokensByUser.get(item.user_id) ?? []).map((to: string) => ({
      to,
      title: item.title,
      body: item.body,
      data: item.data,
      sound: 'default',
      badge: waitingByUser.get(item.user_id) ?? undefined,
    }))
  );

  // Expo's push API caps 100 notifications per request; a batch of queue
  // rows can exceed that when recipients have multiple devices. Chunk, and
  // if any request fails outright, bail WITHOUT stamping sent_at so the
  // whole batch retries next tick.
  const invalidTokens: string[] = [];
  for (let i = 0; i < notifications.length; i += 100) {
    const chunk = notifications.slice(i, i + 100);
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      return Response.json(
        { error: `expo push ${response.status}`, delivered: i },
        { status: 502 }
      );
    }
    const result = await response.json().catch(() => null);
    // One ticket per notification, in order; prune dead tokens.
    const tickets: any[] = result?.data ?? [];
    tickets.forEach((ticket, j) => {
      if (ticket?.details?.error === 'DeviceNotRegistered') {
        invalidTokens.push(chunk[j].to);
      }
    });
  }

  if (invalidTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', invalidTokens);
  }

  // Queue rows are marked sent even for users with no registered tokens —
  // the queue tracks intent, not deliverability.
  await supabase
    .from('push_queue')
    .update({ sent_at: new Date().toISOString() })
    .in(
      'id',
      queued.map((q: any) => q.id)
    );

  return Response.json({ delivered: notifications.length, pruned: invalidTokens.length });
});
