// Buy the Apple refresh token at sign-in, so deletion can spend it later.
//
// Apple hands the app an authorization code exactly once per sign-in, it is
// good for five minutes and for one exchange, and the refresh token it buys is
// the only thing that can later call https://appleid.apple.com/auth/revoke.
// App Review requires that call from any app offering both Sign in with Apple
// and in-app account deletion (5.1.1(v)), so the token has to be captured now
// or the revoke has nothing to spend at deletion time.
//
// The code never leaves the server side of the exchange: the app posts it
// here, this function signs the client secret with the .p8 and stores the
// result in public.apple_refresh_tokens, which is service-role only.
//
// Two failure modes, both deliberately quiet:
//   * The key is not provisioned yet (see docs/APP_STORE.md). Return 200 with
//     stored:false and log it. Sign-in must not fail because a founder task is
//     outstanding, and the app's caller treats this as fire-and-log anyway.
//   * Apple refuses the exchange. Log the status and return 200 with
//     stored:false, for the same reason: the session already exists by the
//     time this is called, and failing here would only break a sign-in that
//     has already succeeded.
//
// Deploy: supabase functions deploy store-apple-token
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { appleConfig, exchangeAuthorizationCode } from '../_shared/apple.ts';

Deno.serve(async (req) => {
  // Same JWT check as delete-account: resolve the caller from their own token
  // rather than trusting a user id in the body, or this becomes a way to
  // overwrite somebody else's stored credential.
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

  let code = '';
  try {
    code = ((await req.json()) as { code?: string }).code ?? '';
  } catch {
    code = '';
  }
  if (!code) {
    return Response.json({ error: 'no authorization code' }, { status: 400 });
  }

  const config = appleConfig();
  if (!config) {
    console.error('store-apple-token: Sign in with Apple key not provisioned; nothing stored');
    return Response.json({ stored: false, reason: 'apple key not configured' });
  }

  let exchange;
  try {
    exchange = await exchangeAuthorizationCode(config, code);
  } catch (error) {
    console.error(`store-apple-token: exchange threw: ${String(error)}`);
    return Response.json({ stored: false, reason: 'exchange failed' });
  }
  if (!exchange.refreshToken) {
    console.error(`store-apple-token: exchange ${exchange.status}: ${exchange.detail}`);
    return Response.json({ stored: false, reason: 'exchange failed' });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { error } = await admin.from('apple_refresh_tokens').upsert(
    {
      user_id: user.id,
      refresh_token: exchange.refreshToken,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    console.error(`store-apple-token: upsert failed: ${error.message}`);
    return Response.json({ stored: false, reason: 'store failed' });
  }

  return Response.json({ stored: true });
});
