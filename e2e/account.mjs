// Throwaway signed-in account for the simulator E2E run: created and
// onboarded before Maestro drives the app, destroyed afterwards via the
// delete-account Edge Function (which also re-exercises the App Review
// 5.1.1(v) path). Anon-key power only — everything here is what a phone
// can do. Dependency-free on purpose: the macOS runner shouldn't pay for
// an npm ci just to make two dozen REST calls.
//
//   node e2e/account.mjs setup      writes E2E_EMAIL/E2E_PASSWORD to $GITHUB_ENV
//   node e2e/account.mjs teardown   deletes the account named by those vars
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
const EMAIL_BASE = process.env.TEST_EMAIL_BASE;
if (!EMAIL_BASE || !EMAIL_BASE.includes('@')) {
  console.error(
    '::error::TEST_EMAIL_BASE is not set to an email address. Test accounts ' +
      'plus-address it, so it must be an inbox you can read. Add it under ' +
      'Settings -> Secrets and variables -> Actions.'
  );
  process.exit(1);
}
const [EMAIL_USER, EMAIL_DOMAIN] = EMAIL_BASE.split('@');

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
  const run = Date.now().toString(36);
  const email = `${EMAIL_USER}+sw-e2e-${run}@${EMAIL_DOMAIN}`;
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
      languages: ['en'],
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
  else throw new Error(`unknown mode: ${mode}`);
} catch (e) {
  console.error(`::error::account ${mode} failed: ${e.message}`);
  process.exit(1);
}
