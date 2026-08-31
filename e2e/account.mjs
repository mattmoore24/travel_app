// Throwaway signed-in account for the simulator E2E run: created and
// onboarded before Maestro drives the app, destroyed afterwards via the
// delete-account Edge Function (which also re-exercises the App Review
// 5.1.1(v) path). Anon-key power only — everything here is what a phone
// can do. Dependency-free on purpose: the macOS runner shouldn't pay for
// an npm ci just to make two dozen REST calls.
//
//   node e2e/account.mjs setup             writes E2E_EMAIL/E2E_PASSWORD to $GITHUB_ENV
//   node e2e/account.mjs teardown          deletes the account named by those vars
//   node e2e/account.mjs teardown-extras   deletes the business and profile
//                                          tours' own throwaways, which sign up
//                                          through the UI rather than here
//
// Env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
//      TEST_EMAIL_BASE, GITHUB_ENV (in CI)
//
// TEST_EMAIL_BASE is required rather than defaulted. Hosted Supabase rejects
// RFC-2606 test domains outright, so a throwaway account needs a real inbox,
// and the only real inbox available to hard-code was a person's own — in a
// public repository. Failing loudly is the right answer: a missing secret is
// a five-second fix, and the alternative is quietly mailing a stranger.

import { appendFileSync } from 'node:fs';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error('::error::EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set');
  process.exit(1);
}

const CITY = 'Bangkok';

/**
 * Required for SETUP only, and checked there rather than at module level.
 * Teardown identifies its account by E2E_EMAIL/E2E_PASSWORD from $GITHUB_ENV
 * and never touches the base — and a module-level exit made teardown die in
 * zero seconds on run 39, which left the throwaway account alive in the live
 * database. The step that cannot run without the secret is the only step
 * that should refuse over it.
 */
function emailParts() {
  const base = process.env.TEST_EMAIL_BASE;
  if (!base || !base.includes('@')) {
    console.error(
      '::error::TEST_EMAIL_BASE is not set to an email address. Test accounts ' +
        'plus-address it, so it must be an inbox you can read. Add it under ' +
        'Settings -> Secrets and variables -> Actions.'
    );
    process.exit(1);
  }
  return base.split('@');
}

async function api(path, { token, ...init } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token ?? KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function setup() {
  const [emailUser, emailDomain] = emailParts();
  const run = Date.now().toString(36);
  const email = `${emailUser}+sw-e2e-${run}@${emailDomain}`;
  const password = `E2e-${run}-${Math.random().toString(36).slice(2, 10)}`;

  const session = await api('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const token = session.access_token;
  const userId = session.user?.id;
  if (!token || !userId) {
    throw new Error('signup returned no session — is email confirmation enabled again?');
  }

  await api(`/rest/v1/profiles?user_id=eq.${userId}`, {
    method: 'PATCH',
    token,
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      display_name: 'Maestro Test',
      age: 27,
      home_city: 'Testville',
      home_country: 'US',
      // Two, and the second is not English on purpose. The travelers card
      // prints "Also speaks Spanish" only when the pair shares something
      // other than English (features/matching/shared-language), and half the
      // demo roster speaks Spanish - so an English-only test account made
      // that line unphotographable.
      languages: ['en', 'es'],
      bio: 'Simulator test account, deleted right after the run.',
      occupation: 'Test runner',
      onboarding_completed_at: new Date().toISOString(),
    }),
  });

  const cities = await api('/rest/v1/rpc/search_cities', {
    method: 'POST',
    token,
    body: JSON.stringify({ p_query: CITY }),
  });
  const city = (cities ?? []).find((c) => c.name === CITY);
  if (!city) throw new Error(`city ${CITY} not found`);

  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await api('/rest/v1/trips', {
    method: 'POST',
    token,
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      city_id: city.id,
      start_date: day(1),
      end_date: day(6),
    }),
  });

  // Mask the secret in job logs before it lands anywhere.
  console.log(`::add-mask::${password}`);
  const envFile = process.env.GITHUB_ENV;
  const lines = `E2E_EMAIL=${email}\nE2E_PASSWORD=${password}\n`;
  if (envFile) {
    appendFileSync(envFile, lines);
  } else {
    process.stdout.write(lines);
  }
  console.log(`setup ok: ${email} onboarded with a ${CITY} trip`);
}

/**
 * The other two throwaways: the business tour's and the profile tour's.
 *
 * Both sign up through the UI, so nothing on the runner knows their ids —
 * only their addresses and the one password the flows type. That is enough
 * to sign in and call the same delete-account function, which also drops the
 * `businesses` row the account owns (see its step 4).
 *
 * This is what lets the business tour REGISTER. Until it existed the flow had
 * to stop at the confirm step, because register_business is not idempotent
 * and one account owns at most one business, so every run would have left a
 * real listing on the live project. Everything after step 5 was therefore
 * unphotographed, which is how a dead end at step 4 reached the founder.
 *
 * Never fatal. A flow that failed before signup leaves no account, and a
 * teardown that cannot find one has nothing to apologise for.
 */
async function teardownExtras() {
  const password = process.env.E2E_THROWAWAY_PASSWORD;
  const addresses = [process.env.E2E_BIZ_EMAIL, process.env.E2E_NEW_EMAIL].filter(Boolean);
  if (!password || addresses.length === 0) {
    console.log('no throwaway addresses in env — nothing extra to tear down');
    return;
  }
  for (const email of addresses) {
    try {
      const session = await api('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      await api('/functions/v1/delete-account', { method: 'POST', token: session.access_token });
      console.log(`teardown ok: ${email} deleted`);
    } catch (e) {
      // Expected whenever a flow stopped before it signed up.
      console.log(`nothing to delete for ${email}: ${e.message.slice(0, 120)}`);
    }
  }
}

async function teardown() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    console.log('no E2E account in env — nothing to tear down');
    return;
  }
  const session = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await api('/functions/v1/delete-account', { method: 'POST', token: session.access_token });
  console.log(`teardown ok: ${email} deleted (pins, trips, profile cascade)`);
}

const mode = process.argv[2];
try {
  if (mode === 'setup') await setup();
  else if (mode === 'teardown') await teardown();
  else if (mode === 'teardown-extras') await teardownExtras();
  else throw new Error(`unknown mode: ${mode}`);
} catch (e) {
  console.error(`::error::account ${mode} failed: ${e.message}`);
  process.exit(1);
}
