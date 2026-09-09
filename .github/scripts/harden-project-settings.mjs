// Sets the three hosted-project settings that no migration in this repository
// can reach, through the Supabase Management API, because they live in a
// dashboard the founder cannot comfortably open and because a security setting
// nobody can assert is a security setting nobody can trust.
//
// WHY THESE THREE AND NOT THE OTHERS. docs/security/MANUAL_CHECKLIST.md §2
// lists six boxes. Three of them are one field each on an endpoint the
// Management API publishes, so they belong in code:
//
//   SEC-002  Exposed schemas          PATCH /v1/projects/{ref}/postgrest
//                                     db_schema
//   SEC-004  Leaked password check    PATCH /v1/projects/{ref}/config/auth
//                                     password_hibp_enabled
//   (§2)     Storage upload ceiling   PATCH /v1/projects/{ref}/config/storage
//                                     fileSizeLimit
//
// SEC-008 (anonymous sign-ins) is READ ONLY here and stays that way: the audit
// asked for it off, and off would break guest mode. See the section itself.
//
// The two that stay in the checklist stay there for a reason, not an oversight:
//   * ORGANISATION SPEND CAP. There is no endpoint. The whole billing surface
//     of the published spec is /v1/organizations{,/{slug}{,/entitlements,
//     /members,/projects}} and /v1/projects/{ref}/billing/addons — reads and
//     add-ons, no subscription, no spend cap. Checked against the spec, not
//     assumed from a failed call.
//   * AUTH RATE LIMITS. Settable (rate_limit_email_sent and friends), and
//     deliberately not set here: the right numbers depend on real signup
//     volume nobody has yet, and a throttle guessed from zero traffic is a
//     support ticket waiting to be filed. It is a review, not a value.
//
// FIELD NAMES were read off the published OpenAPI spec
// (supabase/supabase, apps/docs/spec/transforms/api_v1_openapi_deparsed.json:
// components.schemas.V1UpdatePostgrestConfigBody, .UpdateAuthConfigBody,
// .UpdateStorageConfigBody) rather than recalled.
//
// NOTHING IS PRINTED FROM THE AUTH CONFIG except the two boolean flags this
// file reads. The same GET returns security_captcha_secret, sms_twilio_auth_token
// and twenty other provider secrets, and a workflow log on a PUBLIC repository
// is not the place for any of them. Where this file has to talk about the rest
// of a config it names KEYS, never values. Same rule as enable-apple-provider.
//
// MODE=check reads and reports and writes nothing, so the first run can be a
// look. MODE=apply is the default.

import { createHash } from 'node:crypto';

const API = 'https://api.supabase.com';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const PROJECT_REF = (process.env.PROJECT_REF ?? '').trim();
const APPLY = (process.env.MODE ?? 'apply').trim() !== 'check';

/**
 * The only schemas PostgREST is allowed to serve.
 *
 * `public` is the app's entire API surface. `graphql_public` is kept if it is
 * already there — nothing in this repository speaks GraphQL (grep: no
 * `.schema(`, no `graphql`), but removing it would be a change with a
 * user-visible failure mode and no security gain, and this script's whole
 * contract is that it only ever REMOVES things that should not be exposed.
 *
 * Everything else goes. `net` is the one that matters: pg_net puts
 * `net.http_post` in schema `net` and grants it to PUBLIC, and the migration
 * that tried to revoke that (20260906090000) is a measured no-op — `net` and
 * its twelve functions belong to `supabase_admin`, migrations run as
 * `postgres`, and a non-owner non-superuser revoking is a silent nothing. The
 * ONLY thing that has ever kept `net.http_post` away from an anon key is that
 * schema `net` is not on this list. That is SEC-002, and it is this line.
 */
const ALLOWED_SCHEMAS = ['public', 'graphql_public'];

/**
 * 5 MB, the same number 20260906110000 sets on all five buckets.
 *
 * The project ceiling is the floor under a bucket somebody adds later without
 * thinking about limits; storage.buckets.file_size_limit is null by default
 * and null means "whatever the project allows". Lowered only, never raised: if
 * this reads a smaller number than 5 MB somebody set it on purpose.
 */
const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!TOKEN) fail('SUPABASE_ACCESS_TOKEN is not set.');
if (!PROJECT_REF) fail('PROJECT_REF is not set.');

/**
 * One call to the Management API.
 *
 * A REFUSAL IS A RESULT, NOT THE END OF THE RUN. The first apply run learned
 * this the way these things get learned: `password_hibp_enabled` came back 402
 * ("available on Pro Plans and up"), the helper called `fail`, node exited, and
 * the storage ceiling behind it was never attempted. That is exactly the
 * failure the results table further down was written to avoid — one setting
 * that cannot be written hiding the state of the others. So a per-call refusal
 * is handed back for the section to record, and only a problem with the whole
 * run ends it: a missing token, or a 401/403, which means nothing after this
 * will work either.
 *
 * On failure this reports the status and the API's own `message`, and nothing
 * else from the body — an error body is not a place to relax the rule above.
 */
async function api(method, path, body) {
  const response = await fetch(`${API}/v1/projects/${PROJECT_REF}${path}`, {
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
        `Supabase Management API ${method} ${path}: ${response.status} ${detail}. ` +
          'SUPABASE_ACCESS_TOKEN is expired, or it is not a token for the account that ' +
          `owns project ${PROJECT_REF}. Personal access tokens are time-limited: ` +
          'https://supabase.com/dashboard/account/tokens'
      );
    }
    return { refused: `${response.status} ${detail}`, status: response.status };
  }
  if (!parsed || typeof parsed !== 'object') {
    // A WRITE THAT ANSWERS WITH NOTHING IS STILL A WRITE. PATCH /config/storage
    // returns 200 with an empty body, and the first corrected apply run read
    // that as a refusal and reported the ceiling unchanged when it had not
    // tried to look. Nothing here ever uses a PATCH's response body: the
    // read-back GET is the authority on whether it took. So only a GET that
    // cannot be parsed is a refusal - for that one, an unreadable body means
    // the state is genuinely unknown.
    if (method !== 'GET') {
      return {};
    }
    return {
      refused: `${response.status}, and the body was not JSON`,
      status: response.status,
    };
  }
  return parsed;
}

/** What to tell the founder about a refusal, in their own terms. */
const refusalAdvice = (status) =>
  status === 402
    ? ' This is a paid-plan feature on this project. It is a decision about the ' +
      'plan, not a setting to retry: Dashboard -> Organization -> Billing.'
    : ' Set it in the dashboard, or re-run once the cause is cleared.';

/**
 * A hash over every key of a config document EXCEPT the ones this run owns,
 * and the sorted key list it was taken over.
 *
 * This answers the question the spec cannot: is PATCH a partial update, or
 * does it replace the document? Every property on all three bodies is
 * optional, which is good evidence and not proof. So each section takes this
 * fingerprint before and after and fails if anything it does not own moved. On
 * the postgrest config that is not paranoia: `db_schema` is one of five
 * fields, and a replacing PATCH would silently take `max_rows` and
 * `db_extra_search_path` with it.
 *
 * Values go into the hash and never into the output. A mismatch is reported as
 * key NAMES.
 */
function fingerprint(config, owned) {
  const keys = Object.keys(config)
    .filter((key) => !owned.includes(key))
    .sort();
  const canonical = keys.map((key) => `${key}=${JSON.stringify(config[key])}`).join('\n');
  return { keys, hash: createHash('sha256').update(canonical).digest('hex').slice(0, 16) };
}

/** Names of the keys whose values differ. Names only. */
function changedKeys(before, after, owned) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names]
    .filter((key) => !owned.includes(key))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

/**
 * Every section reports into this, and the exit code is decided at the end
 * rather than at the first failure.
 *
 * One setting that cannot be written must not hide the state of the others:
 * the founder reads this output to know what is still theirs to do, and a run
 * that stopped at the first problem tells them about one box when four were in
 * question.
 */
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}: ${detail}`);
};

/**
 * The shape every section shares: read, decide, write only if the desired
 * state does not already hold, then read BACK from the server rather than
 * trusting the writer to grade its own work. The push-key script learned that
 * one the expensive way.
 */
async function harden({ name, path, owned, read, desired, patch }) {
  const before = await api('GET', path);
  if (before.refused) {
    record(name, false, `could not be read: ${before.refused}${refusalAdvice(before.status)}`);
    return;
  }
  const beforePrint = fingerprint(before, owned);
  const current = read(before);
  const want = desired(current, before);

  if (want === null) {
    record(name, true, `already ${JSON.stringify(current)}. Nothing to change.`);
    return;
  }
  if (!APPLY) {
    record(name, true, `would change ${JSON.stringify(current)} -> ${JSON.stringify(want)}`);
    return;
  }

  const written = await api('PATCH', path, patch(want));
  if (written.refused) {
    record(
      name,
      false,
      `still ${JSON.stringify(current)}; the write was refused: ${written.refused}` +
        refusalAdvice(written.status)
    );
    return;
  }

  // The read-back gets three goes, four seconds apart. Changing `db_schema`
  // restarts PostgREST and changing the auth config restarts GoTrue; a GET
  // answered by a service that has not come back with the new value yet is a
  // FAIL that sends the founder to the dashboard for nothing, and the re-run
  // then says "already set, nothing to change" and contradicts it. Bounded,
  // and it never turns a real failure into a pass - it only spends eight
  // seconds before reporting one.
  let after = await api('GET', path);
  let now = after.refused ? undefined : read(after);
  for (let attempt = 0; attempt < 2 && JSON.stringify(now) !== JSON.stringify(want); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    after = await api('GET', path);
    now = after.refused ? undefined : read(after);
  }
  if (after.refused) {
    record(
      name,
      false,
      `written, but the read-back was refused: ${after.refused}${refusalAdvice(after.status)} ` +
        'Whether it took is unconfirmed.'
    );
    return;
  }

  if (JSON.stringify(now) !== JSON.stringify(want)) {
    record(
      name,
      false,
      `patched to ${JSON.stringify(want)} but a fresh read says ${JSON.stringify(now)}. ` +
        'The setting did NOT take; set it in the dashboard.'
    );
    return;
  }

  const afterPrint = fingerprint(after, owned);
  if (afterPrint.hash !== beforePrint.hash) {
    record(
      name,
      false,
      `set to ${JSON.stringify(now)}, but ${path} changed OUTSIDE the keys this step owns, ` +
        'which means PATCH is not the partial update it assumes. Keys that moved (names ' +
        `only, values are never printed): ${changedKeys(before, after, owned).join(', ') || '(a key was added or removed)'}. ` +
        'Restore them from the dashboard and do not re-run this step.'
    );
    return;
  }

  record(
    name,
    true,
    `${JSON.stringify(current)} -> ${JSON.stringify(now)} ` +
      `(${afterPrint.keys.length} other keys unchanged, ${afterPrint.hash})`
  );
}

console.log(`Project: ${PROJECT_REF}`);
console.log(APPLY ? 'Mode: apply' : 'Mode: check (reads only, writes nothing)');
console.log('');

// --- SEC-002. Exposed schemas ----------------------------------------------
// The field is one comma-separated string, which is why it is split and
// rejoined rather than compared as text: "public,graphql_public" and
// "public, graphql_public" are the same setting and only one of them is what
// the dashboard writes.
await harden({
  name: 'SEC-002 exposed schemas (db_schema)',
  path: '/postgrest',
  owned: ['db_schema'],
  read: (config) =>
    (config.db_schema ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  desired: (current) => {
    const kept = current.filter((schema) => ALLOWED_SCHEMAS.includes(schema));
    // THE ONE WAY THIS COULD BREAK THE APP, guarded rather than assumed. If
    // `public` is somehow not on the list, filtering leaves an empty string
    // and an empty db_schema is a PostgREST that serves nothing — every screen
    // in the app, at once. Refuse instead.
    if (!kept.includes('public')) {
      fail(
        `db_schema is ${JSON.stringify(current)}, which does not include 'public'. That is not ` +
          'a state this script expects and narrowing it would take the whole API down. ' +
          'Nothing was changed. Look at Project Settings -> Data API -> Exposed schemas.'
      );
    }
    return kept.length === current.length ? null : kept;
  },
  patch: (want) => ({ db_schema: want.join(', ') }),
});

// --- SEC-004. Leaked password protection ------------------------------------
// HaveIBeenPwned on every new password. Read from the live advisor as
// disabled; the app's own signup is the only writer of passwords, so there is
// no path this can break except a person choosing a password that is already
// in a breach corpus, which is the point.
await harden({
  name: 'SEC-004 leaked password protection (password_hibp_enabled)',
  path: '/config/auth',
  owned: ['password_hibp_enabled'],
  read: (config) => config.password_hibp_enabled === true,
  desired: (current) => (current === true ? null : true),
  patch: () => ({ password_hibp_enabled: true }),
});

// --- SEC-008. Anonymous sign-ins: A GUARD, NOT A CHANGE ---------------------
//
// THIS SETTING MUST STAY ON, and the audit that asked for it off was wrong.
// SECURITY_AUDIT.md recorded that the app has a guest mode built on real
// accounts and RLS and does not use Supabase's anonymous-sign-in feature. It
// does use it. `signInAsGuest` in src/features/auth/api.ts:84 IS
// `supabase.auth.signInAnonymously()`, and `is_anonymous` is what routing.ts,
// the tab layout, the guest hooks and the business gating all read to tell a
// guest from a member. Turning this off does not harden anything: it takes down
// "look around first", which is the app's front door (docs/DESIGN.md).
//
// It was caught by running this script in `check` mode against the live project
// before applying anything - the run said the setting was ON, which contradicted
// the audit's premise and sent somebody to read the code.
//
// So this section reads and refuses to write. It exists to fail loudly if the
// setting is ever turned off, because the symptom on a phone is a guest button
// that errors and nothing else.
{
  const name = 'SEC-008 anonymous sign-ins (guest mode depends on them)';
  const config = await api('GET', '/config/auth');
  const enabled = config.refused ? null : config.external_anonymous_users_enabled === true;
  if (config.refused) {
    record(name, false, `could not be read: ${config.refused}${refusalAdvice(config.status)}`);
  } else {
    record(
      name,
      enabled,
      enabled
        ? 'ON, which is correct - signInAsGuest is signInAnonymously. Not changed.'
        : 'OFF. Guest mode is built on this: every "look around first" session is ' +
            'an anonymous auth user, so the guest door is broken until it is turned ' +
            'back on at Authentication -> Sign In / Providers.'
    );
  }
}

// --- Storage upload ceiling -------------------------------------------------
await harden({
  name: 'storage upload ceiling (fileSizeLimit)',
  path: '/config/storage',
  owned: ['fileSizeLimit'],
  read: (config) => config.fileSizeLimit ?? null,
  desired: (current) =>
    typeof current === 'number' && current <= STORAGE_LIMIT_BYTES ? null : STORAGE_LIMIT_BYTES,
  patch: (want) => ({ fileSizeLimit: want }),
});

// --- What the founder still has to do themselves ---------------------------
const failed = results.filter((r) => !r.ok);
const pending = results.filter((r) => r.detail.startsWith('would change'));
const headline = !APPLY
  ? pending.length === 0
    ? 'Project settings: nothing to change'
    : `Project settings: ${pending.length} would change (nothing was written)`
  : failed.length === 0
    ? 'Project settings: hardened'
    : `Project settings: ${failed.length} could not be set`;
const summary = [
  `## ${headline}`,
  '',
  `- Project: \`${PROJECT_REF}\``,
  `- Mode: \`${APPLY ? 'apply' : 'check'}\``,
  '',
  ...results.map((r) => `- ${r.ok ? '✅' : '❌'} **${r.name}** — ${r.detail}`),
  '',
  'Still a dashboard errand, because the Management API publishes no endpoint',
  'for it: the **organisation spend cap** (Dashboard → Organization → Billing →',
  'Spend cap), and the **Anthropic monthly spend limit**, which is a different',
  'vendor entirely (console.anthropic.com → Settings → Limits). Auth rate',
  'limits are a review, not a value — see `docs/security/MANUAL_CHECKLIST.md` §2.',
  '',
].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

console.log('');
if (failed.length > 0) {
  fail(
    `${failed.length} of ${results.length} settings are not where they should be: ` +
      `${failed.map((r) => r.name).join(', ')}. Each line above says what it found and what ` +
      'to do about it; the rest are done.'
  );
}
if (!APPLY) {
  // Nothing was written, so nothing was verified — saying otherwise here would
  // be the exact false comfort the read-back exists to prevent.
  console.log(
    pending.length === 0
      ? 'Nothing to change. Re-run in apply mode only if that surprises you.'
      : `${pending.length} of ${results.length} settings would change. Nothing was written: ` +
          'run it again in apply mode to write them.'
  );
} else {
  console.log(
    `All ${results.length} settings verified against a fresh read of the live project. ` +
      'The organisation spend cap and the Anthropic spend limit have no API and are still manual.'
  );
}
