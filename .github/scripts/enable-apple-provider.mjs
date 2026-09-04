// Turns ON the Apple provider in this project's Supabase Auth config, through
// the Management API, because the founder has no machine that can open the
// dashboard's provider form comfortably and this has to be repeatable.
//
// THIS IS THE (a) HALF OF SIGN IN WITH APPLE AND IT NEEDS NO KEY. Two things
// get conflated constantly:
//   (a) the sign-in working at all — the provider enabled with the app's
//       bundle id as an acceptable audience. That is this file.
//   (b) the revoke on account deletion (App Review 5.1.1(v)) — the four
//       APPLE_* Edge Function secrets, synced by supabase-deploy.yml's
//       "Sync Sign in with Apple secrets" step. That needs the .p8.
// (a) without (b) is an app that signs people in and gets rejected by App
// Review. (b) without (a) is a revoke path nobody can reach. They are
// independent and both are required.
//
// FIELD NAMES were read off the published OpenAPI spec
// (supabase/supabase, apps/docs/spec/transforms/api_v1_openapi_deparsed.json,
// components.schemas.UpdateAuthConfigBody) rather than recalled:
//   external_apple_enabled, external_apple_client_id,
//   external_apple_email_optional, external_apple_secret,
//   external_apple_additional_client_ids.
// Only the first two are written here. See the notes at each decision below.
//
// NOTHING IS PRINTED FROM THE CONFIG except the Apple enable flag and the
// client id list, both public facts. The same GET returns
// security_captcha_secret, sms_twilio_auth_token and twenty other provider
// secrets, and a workflow log is not the place for any of them. Where this
// file has to talk about the rest of the config it names KEYS, never values.

import { createHash } from 'node:crypto';

const API = 'https://api.supabase.com';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const PROJECT_REF = (process.env.PROJECT_REF ?? '').trim();

// The bundle id, passed in from the workflow so there is one spelling of it in
// the repository. NOT a Services ID: see the block above the merge below.
const CLIENT_ID = (process.env.APPLE_CLIENT_ID ?? '').trim();

// AND IT HAS TO BE THE APP'S OWN BUNDLE ID, checked rather than trusted.
// The read-back at the end used to say "the provider is on and carries the
// bundle id" while only ever proving that whatever string the workflow passed
// had round-tripped - so it would have passed just as happily with a wrong
// client id, which is the one mistake that matters here. GoTrue builds its
// acceptable-audience list from this value, and a device's identity token
// carries the bundle id as `aud`, so a mismatch is a sign-in that fails with
// "Unacceptable audience in id_token" and a config that looks correct.
// app.json is the only source of truth for what that bundle id is.
const BUNDLE_ID = JSON.parse(
  (await import('node:fs')).readFileSync(new URL('../../app.json', import.meta.url), 'utf8')
).expo.ios.bundleIdentifier;
if (CLIENT_ID !== BUNDLE_ID) {
  fail(
    `APPLE_CLIENT_ID is "${CLIENT_ID}" but app.json's ios.bundleIdentifier is ` +
      `"${BUNDLE_ID}". For the native sign-in this app uses ` +
      '(supabase.auth.signInWithIdToken), the acceptable audience IS the bundle id, ' +
      'so these must be the same string.'
  );
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!TOKEN) {
  fail('SUPABASE_ACCESS_TOKEN is not set.');
}
if (!PROJECT_REF) {
  fail('SUPABASE_PROJECT_REF is not set.');
}
if (!CLIENT_ID) {
  fail('APPLE_CLIENT_ID is not set. It is the app bundle id, e.g. com.example.app.');
}

/**
 * One call to the auth-config endpoint.
 *
 * On failure this prints the status and the API's own `message`, and nothing
 * else from the body — an error body is not a place to relax the rule above.
 */
async function authConfig(method, body) {
  const response = await fetch(`${API}/v1/projects/${PROJECT_REF}/config/auth`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const detail =
      parsed && typeof parsed.message === 'string' ? parsed.message : '(body withheld)';
    if (response.status === 401 || response.status === 403) {
      fail(
        `Supabase Management API ${method} auth config: ${response.status} ${detail}. ` +
          'SUPABASE_ACCESS_TOKEN is expired, or it is not a token for the account that ' +
          `owns project ${PROJECT_REF}. Personal access tokens are time-limited: ` +
          'https://supabase.com/dashboard/account/tokens'
      );
    }
    fail(`Supabase Management API ${method} auth config: ${response.status} ${detail}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    fail(`Supabase Management API ${method} auth config answered ${response.status} but not JSON.`);
  }
  return parsed;
}

/**
 * A hash over every NON-Apple key in the auth config, and the sorted key list
 * it was taken over.
 *
 * This exists to answer the one question the OpenAPI spec cannot: is PATCH a
 * partial update, or does it replace the document? The spec says every one of
 * the 234 properties on UpdateAuthConfigBody is optional and nullable, and
 * Supabase's own docs patch three fields on their own, which is good evidence
 * and not proof. So the run takes this fingerprint before and after, and fails
 * if anything outside the Apple block moved. A silently reset SMTP host or
 * session timeout would otherwise be discovered by a user, weeks later.
 *
 * Values go into the hash and never into the output. A mismatch is reported as
 * key NAMES.
 */
function fingerprint(config) {
  const keys = Object.keys(config)
    .filter((key) => !key.startsWith('external_apple_'))
    .sort();
  const canonical = keys.map((key) => `${key}=${JSON.stringify(config[key])}`).join('\n');
  return { keys, hash: createHash('sha256').update(canonical).digest('hex').slice(0, 16) };
}

/** Names of the keys whose values differ. Names only. */
function changedKeys(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names]
    .filter((key) => !key.startsWith('external_apple_'))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

/** The Client IDs field is a comma-separated list, per GoTrue's `ClientID []string`. */
function clientIds(value) {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

// --- 1. What is there now ---------------------------------------------------
const before = await authConfig('GET');
const beforePrint = fingerprint(before);
const existing = clientIds(before.external_apple_client_id);

console.log(`Project: ${PROJECT_REF}`);
console.log(`Apple provider enabled: ${before.external_apple_enabled === true}`);
console.log(`Apple client IDs: ${existing.join(', ') || '(none)'}`);
console.log(
  `Apple OAuth secret configured: ${Boolean(before.external_apple_secret)} ` +
    '(not used by the native flow; see below)'
);
console.log(
  `Non-Apple auth settings: ${beforePrint.keys.length} keys, fingerprint ${beforePrint.hash}`
);

// --- 2. The client id, and why it is the bundle id --------------------------
// ESTABLISHED, not assumed. The app signs in with
// `supabase.auth.signInWithIdToken({ provider: 'apple', token })` — the native
// path, src/features/auth/api.ts. GoTrue's handler for that grant
// (supabase/auth, internal/api/token_oidc.go) builds `acceptableClientIDs`
// from `config.External.Apple.ClientID` plus `config.External.IosBundleId`,
// and then requires the id_token's `aud` to contain one of them. The token
// expo-apple-authentication returns on a device is audienced to the APP's
// bundle id. A Services ID is the audience of the web redirect flow, which
// this app does not have, so a Services ID here would leave `aud` unmatched
// and every sign-in refused with "Unacceptable audience in id_token".
//
// APPEND, never replace. `external_apple_client_id` is one comma-separated
// field shared by both flows, and Supabase's docs are explicit that the FIRST
// entry is the one the web `signInWithOAuth` flow uses while the native
// `signInWithIdToken` flow accepts any entry in the list. So if a Services ID
// (or `host.exp.Exponent`, for Expo Go) is ever added by hand, this must not
// evict it or reorder it.
const desired = existing.includes(CLIENT_ID) ? existing : [...existing, CLIENT_ID];

// `external_apple_secret` is deliberately NOT in the patch body. It is the
// OAuth client secret for the web redirect flow: GoTrue reads it only in
// NewAppleProvider, whose ValidateOAuth() requires a secret and a redirect
// URI, and the id_token path above never touches it. Supabase's own guide
// says so in as many words — "If you're building a native app only, you do not
// need to configure the OAuth settings." Sending "" would also wipe a secret
// somebody had configured on purpose. The .p8 this project does need is for
// the REVOKE, and it goes to the Edge Function secrets, not here.
const alreadyRight = before.external_apple_enabled === true && existing.includes(CLIENT_ID);

if (alreadyRight) {
  console.log(`Already enabled with ${CLIENT_ID} in the client IDs. Nothing to change.`);
} else {
  await authConfig('PATCH', {
    external_apple_enabled: true,
    external_apple_client_id: desired.join(','),
  });
  console.log(`Patched: enabled, client IDs -> ${desired.join(', ')}`);
}

// --- 3. Read it back from the server, not from the response -----------------
// The PATCH answers with a config document, and using that as the check would
// be trusting the writer to grade its own work. The push-key script learned
// this the expensive way: its first version reported "team and key are both
// present" — true of the ACCOUNT, and not the question, because the app's own
// credentials carried neither, and the send failed anyway. So: a fresh GET.
const after = await authConfig('GET');
const afterIds = clientIds(after.external_apple_client_id);

console.log(`Read back — enabled: ${after.external_apple_enabled === true}`);
console.log(`Read back — client IDs: ${afterIds.join(', ') || '(none)'}`);

if (after.external_apple_enabled !== true) {
  fail(
    'The Apple provider is still NOT enabled after the patch. Sign in with Apple will fail ' +
      'with "Provider (issuer https://appleid.apple.com) is not enabled". Check the ' +
      'Authentication → Sign In / Providers page for this project.'
  );
}
if (!afterIds.includes(CLIENT_ID)) {
  fail(
    `The Apple provider is enabled but ${CLIENT_ID} is NOT in its client IDs (${
      afterIds.join(', ') || 'empty'
    }). Every native sign-in would be refused with "Unacceptable audience in id_token".`
  );
}

// --- 4. Prove the patch was partial ----------------------------------------
const afterPrint = fingerprint(after);
if (afterPrint.hash !== beforePrint.hash) {
  const moved = changedKeys(before, after);
  fail(
    'The auth config changed OUTSIDE the Apple block during this run, which means PATCH is ' +
      'not the partial update this step assumes. Keys that moved (names only, values are ' +
      `never printed): ${moved.join(', ') || '(a key was added or removed)'}. Restore them ` +
      'from the dashboard and do not re-run this step until it patches only what it names.'
  );
}
console.log(
  `Non-Apple auth settings unchanged (${afterPrint.keys.length} keys, fingerprint ${afterPrint.hash}).`
);

const summary = [
  '## Sign in with Apple: provider enabled',
  '',
  `- Project: \`${PROJECT_REF}\``,
  `- Enabled: \`${after.external_apple_enabled === true}\``,
  `- Client IDs: \`${afterIds.join(', ')}\``,
  `- Non-Apple auth settings: unchanged (\`${afterPrint.hash}\`)`,
  '',
  'This is the half that lets people sign in. Revocation on account deletion',
  'is separate and needs the four `APPLE_*` function secrets — see',
  '`docs/APP_STORE.md`, "Sign in with Apple".',
  '',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
console.log(
  `Verified against a fresh GET: the provider is on and carries ${BUNDLE_ID}, ` +
    "which is app.json's own ios.bundleIdentifier rather than whatever this " +
    'workflow happened to pass.'
);
