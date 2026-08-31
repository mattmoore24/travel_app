// Demo travelers for testing the Travelers tab, matching, pins and messaging.
//
//   node scripts/seed-demo-travelers.mjs seed
//   node scripts/seed-demo-travelers.mjs purge
//
// These accounts are created through the PUBLIC signup path with the anon key,
// exactly like a real phone would: no service-role key, no special privileges,
// so nothing here can do something a user could not.
//
// They are not real people. The portraits are AI-generated (no real person's
// likeness), every bio carries a visible [demo] marker, and LAUNCH_RUNBOOK
// step 4 requires purging them before real users arrive.
//
// Env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, DEMO_PASSWORD
//      (shared password for the demo accounts; keep it in GitHub secrets so
//      strangers cannot sign in as a demo traveler while the repo is public)

import { readFileSync } from 'node:fs';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = process.env.DEMO_PASSWORD;
const EMAIL_BASE = process.env.TEST_EMAIL_BASE;
if (!EMAIL_BASE || !EMAIL_BASE.includes('@')) {
  console.error(
    '::error::TEST_EMAIL_BASE is not set to an email address. Demo accounts ' +
      'plus-address it. Add it under Settings -> Secrets and variables -> Actions.'
  );
  process.exit(1);
}

if (!URL_ || !KEY) {
  console.error('::error::EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set');
  process.exit(1);
}
if (!PASSWORD || PASSWORD.length < 12) {
  console.error('::error::DEMO_PASSWORD secret missing (needs 12+ characters)');
  process.exit(1);
}

const [EMAIL_USER, EMAIL_DOMAIN] = EMAIL_BASE.split('@');
const emailFor = (slug) => `${EMAIL_USER}+sw-demo-${slug}@${EMAIL_DOMAIN}`;
const { people } = JSON.parse(readFileSync(new URL('./demo-travelers.json', import.meta.url)));

async function api(path, { token, raw, ...init } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token ?? KEY}`,
      ...(raw ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function signIn(slug) {
  return api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: emailFor(slug), password: PASSWORD }),
  });
}

/** Signs up, or signs in when the account already exists (re-runnable). */
async function ensureAccount(slug) {
  try {
    const session = await api('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email: emailFor(slug), password: PASSWORD }),
    });
    if (session?.access_token) {
      return { session, created: true };
    }
  } catch (e) {
    if (!/already|registered/i.test(e.message)) throw e;
  }
  return { session: await signIn(slug), created: false };
}

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Four trips each, one per launch city. Window 0 is live today for EVERY
// demo traveler, so whichever city the founder opens has people in it now
// and the map has avatar pins; the later three are staggered by person so a
// trip booked two months out still finds somebody instead of the empty
// state. Windows never overlap within one person - a traveler cannot be in
// Lisbon and Bangkok in the same week, and their profile lists all four.
// The active-trip cap is 5, so four is the ceiling.
const WINDOWS = [
  [-3, 30],
  [33, 66],
  [72, 104],
  [110, 148],
];
// cities[] rotates by index (person 0 starts in Lisbon, 1 in Bangkok, 2 in
// Mexico City, 3 in Denpasar, 4 back to Lisbon), so each city is somebody's
// window-0 city three times over. The three people who share a rotation are
// then pushed 0, 12 and 24 days apart in the later windows, which turns
// three separate month-long stays into one continuous run of coverage per
// city instead of three clumps with holes between them.
const windowFor = (index, w) => {
  const [from, to] = WINDOWS[w];
  const phase = (Math.floor(index / 4) - 1) * 12;
  // Window 0 always STARTS today, whatever the phase, so nobody is missing
  // from the city they are supposed to be in right now; only its end moves.
  return w === 0 ? [from, to + phase] : [from + phase, to + phase];
};

async function seed() {
  for (const [index, person] of people.entries()) {
    const { session, created } = await ensureAccount(person.slug);
    const token = session.access_token;
    const userId = session.user.id;

    await api(`/rest/v1/profiles?user_id=eq.${userId}`, {
      method: 'PATCH',
      token,
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        display_name: person.name,
        age: person.age,
        gender: person.gender,
        occupation: person.occupation,
        home_city: person.homeCity,
        home_country: person.homeCountry,
        languages: person.languages,
        bio: person.bio,
        onboarding_completed_at: new Date().toISOString(),
      }),
    });

    // Prompts, because a card with three answers on it is the thing the
    // Travelers tab is actually built to show. Upsert on (user_id, slot) so
    // re-running rewrites rather than colliding on the primary key.
    if (person.prompts?.length) {
      await api('/rest/v1/profile_prompts', {
        method: 'POST',
        token,
        headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify(
          person.prompts.map((prompt, slot) => ({
            user_id: userId,
            slot,
            prompt_key: prompt.key,
            answer: prompt.answer,
          }))
        ),
      });
    }

    const cityRows = [];
    for (const name of person.cities) {
      const found = await api('/rest/v1/rpc/search_cities', {
        method: 'POST',
        token,
        body: JSON.stringify({ p_query: name }),
      });
      const row = (found ?? []).find((c) => c.name === name);
      if (!row) throw new Error(`city ${name} not found`);
      cityRows.push(row);
    }
    // The city they are in TODAY, and so the one their pin belongs to.
    const city = cityRows[0];

    // Trips are replaced rather than stacked, so re-running stays idempotent.
    await api(`/rest/v1/trips?user_id=eq.${userId}`, { method: 'DELETE', token });
    for (const [w, row] of cityRows.entries()) {
      const [from, to] = windowFor(index, w);
      await api('/rest/v1/trips', {
        method: 'POST',
        token,
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          city_id: row.id,
          start_date: day(from),
          end_date: day(to),
        }),
      });
    }

    // One photo, uploaded through the same storage path the app uses, so it
    // goes through the real moderation queue like any user's photo.
    const existing = await api(`/rest/v1/profile_photos?user_id=eq.${userId}&select=id`, { token });
    if (created || (existing ?? []).length === 0) {
      try {
        const image = await fetch(person.photoUrl);
        if (!image.ok) throw new Error(`photo fetch ${image.status}`);
        const bytes = Buffer.from(await image.arrayBuffer());
        const path = `${userId}/${person.slug}-1.png`;
        await api(`/storage/v1/object/profile-photos/${path}`, {
          method: 'POST',
          token,
          raw: true,
          headers: { 'Content-Type': 'image/png' },
          body: bytes,
        });
        await api('/rest/v1/profile_photos', {
          method: 'POST',
          token,
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ user_id: userId, storage_path: path, position: 0 }),
        });
      } catch (e) {
        // A dead generation link should not block the rest of the seed.
        console.log(`::warning::photo for ${person.slug} skipped: ${e.message}`);
      }
    }

    // A live pin so the map has real user pins (avatar markers) to test.
    if (person.pin) {
      const [dLat, dLng] = person.pin.offset;
      await api(`/rest/v1/pins?user_id=eq.${userId}`, { method: 'DELETE', token });
      await api('/rest/v1/pins', {
        method: 'POST',
        token,
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          city_id: city.id,
          venue_name: person.pin.venue,
          category: person.pin.category,
          lat: Number(city.lat) + dLat,
          lng: Number(city.lng) + dLng,
          intent_date: day(0),
          // Just inside the 72h ceiling, so pins survive a few days of testing.
          expires_at: new Date(Date.now() + 71 * 3600000).toISOString(),
        }),
      });
    }

    console.log(
      `ok   ${person.name} in ${person.cities[0]} now, then ${person.cities.slice(1).join(', ')} ` +
        `(${created ? 'created' : 'refreshed'})`
    );
  }
  console.log(`\n${people.length} demo travelers ready. Purge with: seed-demo-travelers.mjs purge`);
}

async function purge() {
  let gone = 0;
  for (const person of people) {
    try {
      const session = await signIn(person.slug);
      await api('/functions/v1/delete-account', {
        method: 'POST',
        token: session.access_token,
      });
      gone += 1;
      console.log(`ok   ${person.name} deleted`);
    } catch (e) {
      console.log(`--   ${person.name} not present (${e.message.slice(0, 60)})`);
    }
  }
  console.log(`\n${gone} demo travelers removed.`);
}

/**
 * The launch gate: RED while any demo account can still sign in. The purge
 * used to be a runbook sentence somebody had to remember and then trust;
 * this makes it a workflow run that fails until the purge actually took —
 * run `purge`, then `check`, and green is the evidence.
 */
async function check() {
  const present = [];
  for (const person of people) {
    try {
      await signIn(person.slug);
      present.push(person.name);
      console.log(`!!   ${person.name} can still sign in`);
    } catch (e) {
      // Only an invalid-credentials 400 from the token endpoint proves the
      // account is gone. Every other failure — a rotated DEMO_PASSWORD, an
      // auth outage, a 429 — throws the same way, and a gate that reads all
      // of them as "gone" is green exactly when it knows least. Fail the run
      // instead, so somebody looks.
      if (!/-> 400:/.test(e.message)) {
        throw new Error(
          `${person.name}: could not tell whether the account is gone ` +
            `(${e.message.slice(0, 120)}). The check needs a working anon key ` +
            'and the DEMO_PASSWORD the seed used.'
        );
      }
      console.log(`ok   ${person.name} gone`);
    }
  }
  if (present.length > 0) {
    throw new Error(
      `${present.length} demo travelers still live (${present.join(', ')}). ` +
        'Run the workflow with `purge`, then `check` again.'
    );
  }
  console.log(`\nAll ${people.length} demo travelers are gone.`);
}

const mode = process.argv[2];
try {
  if (mode === 'seed') await seed();
  else if (mode === 'purge') await purge();
  else if (mode === 'check') await check();
  else throw new Error('usage: seed-demo-travelers.mjs seed|purge|check');
} catch (e) {
  console.error(`::error::${mode} failed: ${e.message}`);
  process.exit(1);
}
