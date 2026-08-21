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

Deno.serve(async () => {
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
