// In-app account deletion (App Review guideline 5.1.1(v)).
//
// Called by the signed-in user from the Profile tab. Order matters:
//   1. Verify the caller's JWT and resolve their user id.
//   2. Remove their storage objects (profile photos + any verification
//      selfies) — the storage API is the only correct way to delete objects.
//   3. Hard-delete every chat they participate in (mirrors unmatch: "deletes
//      chat for both") so no orphaned conversations linger for the other
//      member. Closed chats included: the account is leaving entirely.
//   4. Delete the auth user — the FK graph cascades users -> profiles,
//      photos, handles, trips, pins, requests, blocks, reports, tokens.
//      moderation_events survive with subject_user_id = null (audit spine).
//
// Deploy: supabase functions deploy delete-account
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'not authenticated' }, { status: 401 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 2. Storage cleanup (both buckets, everything under <uid>/).
  for (const bucket of ['profile-photos', 'verification-selfies']) {
    const { data: objects } = await admin.storage.from(bucket).list(user.id, { limit: 1000 });
    const paths = (objects ?? []).map((o: any) => `${user.id}/${o.name}`);
    if (paths.length > 0) {
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) {
        // Keep going — an orphaned unreachable object must not block the
        // user's right to delete their account; log for ops.
        console.error(`storage cleanup ${bucket}: ${error.message}`);
      }
    }
  }

  // 3. Chats they belong to — delete for both members (unmatch semantics).
  const { data: memberships } = await admin
    .from('chat_participants')
    .select('chat_id')
    .eq('user_id', user.id);
  const chatIds = [...new Set((memberships ?? []).map((m: any) => m.chat_id))];
  if (chatIds.length > 0) {
    // Detach request rows first (FK to chats without cascade — the request
    // row's unique pair constraint is the anti-re-pester rule and it dies
    // with the user in step 4 anyway when they are a party to it).
    await admin.from('message_requests').update({ chat_id: null }).in('chat_id', chatIds);
    const { error } = await admin.from('chats').delete().in('id', chatIds);
    if (error) {
      return Response.json({ error: `chat cleanup failed: ${error.message}` }, { status: 500 });
    }
  }

  // 4. The auth user — cascades the entire public-schema footprint.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  return Response.json({ deleted: true });
});
