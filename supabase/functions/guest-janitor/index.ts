// Removes anonymous accounts that have gone quiet.
//
// Guests are free to mint, so they have to be free to remove. stale_guest_ids
// names them (anonymous, 30 days old, no live membership, nothing said in the
// last 30 days) and this deletes them through the admin API.
//
// Why a worker and not a pg_cron one-liner: deleting an auth row from SQL may
// or may not be permitted for the migration role, and the one place in this
// project that already deletes a user - delete-account - goes through
// admin.auth.admin.deleteUser for exactly that reason. A nightly job that
// silently cannot do its job is worse than no job.
//
// Deleting a guest takes their messages with them, by cascade. That is the
// intent, not a side effect: a throwaway identity is not a place to keep
// somebody's words forever.
//
// Deploy:   supabase functions deploy guest-janitor
// Schedule: pg_cron, daily (see 20260823060000_guests_can_chat.sql)
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Service role only. Same guard, written inline, as every other worker here.
 *
 * The claim is checked rather than the key string: a Supabase function
 * accepts the ANON key as a valid JWT, and the anon key ships inside the app,
 * so without this anyone who pulled it out of the IPA could drive account
 * deletion in a loop. Comparing against SUPABASE_SERVICE_ROLE_KEY instead is
 * what took moderation down for half an hour on 2026-08-21.
 *
 * Safe to read the payload without verifying it: these deploy without
 * --no-verify-jwt and the project has no config.toml, so the platform has
 * already checked the signature. If that changes, this becomes forgeable and
 * must change with it.
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

Deno.serve(async (req) => {
  if (!isServiceCaller(req)) {
    return Response.json({ error: 'not authorized' }, { status: 401 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await admin.rpc('stale_guest_ids', { p_limit: 200 });
  if (error) {
    return Response.json({ error: `stale_guest_ids: ${error.message}` }, { status: 500 });
  }

  const ids = ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);
  let removed = 0;
  const failures: string[] = [];

  for (const id of ids) {
    // One at a time, and a failure does not stop the sweep: one undeletable
    // row must not hold up the other 199, and tomorrow's run picks it up
    // again because the query is a live one rather than a queue.
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) {
      failures.push(`${id}: ${deleteError.message}`);
    } else {
      removed += 1;
    }
  }

  return Response.json({ considered: ids.length, removed, failures });
});
