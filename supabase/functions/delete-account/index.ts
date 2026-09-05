// In-app account deletion (App Review guideline 5.1.1(v)).
//
// Called by the signed-in user from the Profile tab. Order matters:
//   1. Verify the caller's JWT and resolve their user id.
//   2. Remove their storage objects (profile photos, verification selfies,
//      chat photos, and a place's gallery and storefront evidence) — the
//      storage API is the only correct way to delete objects.
//   3. Hard-delete every chat they participate in (mirrors unmatch: "deletes
//      chat for both") so no orphaned conversations linger for the other
//      member. Closed chats included: the account is leaving entirely.
//   4. Delete the place this account runs, if it runs one. `businesses`
//      references the user with ON DELETE SET NULL, so step 5 alone would
//      leave the whole listing standing — name, photos, posts, hours, links,
//      ratings and its chat — owned by nobody and editable by nobody. That is
//      not what "delete my account" means, and 5.1.1(v) applies to a business
//      account exactly as it does to a traveler's.
//   5. Tell Apple to forget the account, if it signed in with Apple. This has
//      to happen BEFORE step 6, because the stored refresh token cascades away
//      with the user row and there would be nothing left to revoke. It fails
//      soft: a revoke that does not land is logged and the deletion carries
//      on, because somebody's right to delete their account cannot depend on
//      another company's endpoint being up.
//   6. Delete the auth user — the FK graph cascades users -> profiles,
//      photos, handles, trips, pins, requests, blocks, reports, tokens.
//      moderation_events survive with subject_user_id = null (audit spine).
//
// Deploy: supabase functions deploy delete-account
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { appleConfig, revokeRefreshToken } from '../_shared/apple.ts';

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

  // 2. Storage cleanup: every bucket, everything under <uid>/.
  //
  // chat-photos belongs on this list. Deleting the account cascades the
  // `messages` rows, but every JPEG somebody sent into a hostel room or a
  // group used to stay in the bucket afterwards, under a path that is their
  // own user id. "Delete my account" has to mean the photos too.
  //
  // Paged, because `list` returns a bounded page: one call cleaned a light
  // user completely and a heavy one partially, which is the worse of the two
  // failures because it looks like it worked.
  //
  // The two business buckets are on this list for the same reason: both use
  // the `<owner uid>/<file>` path convention (business_content.sql spells out
  // why the business id could not go first), so the same loop reaches a
  // place's gallery photos and its storefront evidence.
  const PAGE = 100;
  for (const bucket of [
    'profile-photos',
    'verification-selfies',
    'chat-photos',
    'business-photos',
    'business-verification',
  ]) {
    for (let offset = 0; ; offset += PAGE) {
      const { data: objects, error: listError } = await admin.storage
        .from(bucket)
        .list(user.id, { limit: PAGE, offset });
      if (listError) {
        console.error(`storage list ${bucket}: ${listError.message}`);
        break;
      }
      const paths = (objects ?? []).map((o: any) => `${user.id}/${o.name}`);
      if (paths.length === 0) {
        break;
      }
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) {
        // Keep going — an orphaned unreachable object must not block the
        // user's right to delete their account; log for ops.
        console.error(`storage cleanup ${bucket}: ${error.message}`);
        break;
      }
      if (paths.length < PAGE) {
        break;
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

  // 4. The place this account runs, if any.
  //
  // Deleting the `businesses` row cascades its photos, links, hours, posts,
  // verifications, reports, scans, ratings and email confirmations, all of
  // which are keyed on business_id. Its chat is not: `businesses.chat_id` is
  // ON DELETE SET NULL, which points the wrong way, so the chat has to be
  // taken out by hand afterwards or the room and its messages outlive the
  // place they belonged to.
  //
  // A launch venue that this account had claimed goes with it. That is the
  // right answer — the photos and posts on it were theirs — and
  // seed_launch_businesses() is idempotent, so putting the bare venue back is
  // one call.
  const { data: owned } = await admin
    .from('businesses')
    .select('id, chat_id')
    .eq('owner_user_id', user.id)
    .maybeSingle();
  if (owned) {
    const { error } = await admin.from('businesses').delete().eq('id', owned.id);
    if (error) {
      return Response.json({ error: `place cleanup failed: ${error.message}` }, { status: 500 });
    }
    if (owned.chat_id) {
      const { error: chatError } = await admin.from('chats').delete().eq('id', owned.chat_id);
      if (chatError) {
        // The listing is already gone, which is the part that mattered. An
        // orphaned room with no way back to it must not block the deletion.
        console.error(`business chat cleanup: ${chatError.message}`);
      }
    }
  }

  // 5. Apple, if this account signed in with Apple.
  //
  // Fail soft, loudly. App Review requires the revoke call, and a silent
  // failure here is the shape of bug that only shows up as a rejection months
  // later, so every branch logs which one it took: no token, no key, an error
  // from Apple, or a status code. What it must never do is throw, return, or
  // otherwise stand between somebody and the deletion they asked for.
  //
  // Ordering matters. apple_refresh_tokens references public.users with
  // on delete cascade, so after step 6 the token is gone and the grant would
  // stay live under iOS Settings forever.
  try {
    const { data: appleRow, error: appleReadError } = await admin
      .from('apple_refresh_tokens')
      .select('refresh_token')
      .eq('user_id', user.id)
      .maybeSingle();
    if (appleReadError) {
      console.error(`apple revoke: could not read token: ${appleReadError.message}`);
    } else if (!appleRow) {
      // Every account that never used Sign in with Apple lands here.
      console.log('apple revoke: no token for this account, nothing to revoke');
    } else {
      const config = appleConfig();
      if (!config) {
        console.error('apple revoke: Sign in with Apple key not provisioned; token NOT revoked');
      } else {
        const result = await revokeRefreshToken(config, appleRow.refresh_token);
        if (result.ok) {
          console.log(`apple revoke: ok (${result.status})`);
        } else {
          console.error(`apple revoke: failed (${result.status}): ${result.detail}`);
        }
      }
    }
  } catch (error) {
    console.error(`apple revoke: threw: ${String(error)}`);
  }

  // 6. The auth user — cascades the entire public-schema footprint.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  return Response.json({ deleted: true });
});
