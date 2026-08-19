// Drives the demo travelers through the message-request loop so the founder
// can see both ends of it on a real phone:
//
//   node scripts/demo-interactions.mjs accept   demo travelers accept requests they were sent
//   node scripts/demo-interactions.mjs ping     a demo traveler sends the founder a request
//   node scripts/demo-interactions.mjs both     accept, then ping from someone else
//
// Anon key only, through the same RPCs the app calls: nothing here can do
// anything a user could not do by tapping. The accounts are the seeded demo
// personas (scripts/demo-travelers.json), so LAUNCH_RUNBOOK step 4's purge
// still clears everything this touches.
//
// Env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, DEMO_PASSWORD

import { readFileSync } from 'node:fs';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = process.env.DEMO_PASSWORD;
const EMAIL_BASE = process.env.TEST_EMAIL_BASE || 'mattmoorefb24@gmail.com';
/** Who accepts, and who is asked to reach out afterwards. */
const ACCEPTER = process.env.DEMO_ACCEPTER || 'dev';

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
    throw new Error(`${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

const rpc = (name, token, body = {}) =>
  api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: JSON.stringify(body) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Signs every persona in once; everything below works off these sessions. */
async function signInAll() {
  const crew = [];
  for (const person of people) {
    try {
      const session = await api('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: emailFor(person.slug), password: PASSWORD }),
      });
      crew.push({ ...person, token: session.access_token, userId: session.user.id });
    } catch (e) {
      console.log(`--   ${person.name} could not sign in (${e.message.slice(0, 80)})`);
    }
  }
  if (crew.length === 0) {
    throw new Error('no demo travelers could sign in — has the seed run?');
  }
  return crew;
}

/**
 * Anyone who is not one of our own personas is the human we are testing with.
 * Their id turns up either in a request they sent or in a trip overlap.
 */
function outsiders(rows, crew, key) {
  const ours = new Set(crew.map((c) => c.userId));
  return rows.filter((r) => !ours.has(r[key]));
}

/**
 * A request only becomes visible to its recipient after moderation releases
 * it, which the worker does about once a minute — so this waits rather than
 * reporting an empty inbox.
 */
async function findPendingRequests(crew, { attempts = 10, waitMs = 20000 } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    const found = [];
    for (const person of crew) {
      const incoming = await rpc('incoming_requests', person.token);
      for (const req of outsiders(incoming ?? [], crew, 'sender_id')) {
        found.push({ person, req });
      }
    }
    if (found.length > 0) {
      return found;
    }
    if (i < attempts) {
      console.log(
        `..   nothing in the inbox yet (${i}/${attempts}); first messages sit in moderation for a minute`
      );
      await sleep(waitMs);
    }
  }
  return [];
}

async function accept(crew) {
  const pending = await findPendingRequests(crew);
  if (pending.length === 0) {
    console.log('--   no requests waiting for any demo traveler');
    return null;
  }

  // Whoever was written to gets to answer; the founder's own pick first.
  pending.sort((a, b) => (a.person.slug === ACCEPTER ? -1 : b.person.slug === ACCEPTER ? 1 : 0));

  let founderId = null;
  for (const { person, req } of pending) {
    console.log(`\n>>   ${person.name} was sent: "${req.first_message}"`);
    const result = await rpc('respond_to_message_request', person.token, {
      p_request_id: req.id,
      p_accept: true,
    });
    if (!result?.accepted || !result.chat_id) {
      console.log(`--   ${person.name} could not accept it`);
      continue;
    }
    founderId = req.sender_id;
    console.log(`ok   ${person.name} accepted (chat ${result.chat_id})`);

    // A chat that opens empty is a let-down; say something worth reading.
    const opener =
      person.replyOpener ??
      `Yes please. I am around all week, so tell me what you are up for and I will make it work.`;
    await api('/rest/v1/messages', {
      method: 'POST',
      token: person.token,
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ chat_id: result.chat_id, sender_id: person.userId, body: opener }),
    });
    console.log(`ok   ${person.name} replied in chat: "${opener}"`);
  }
  return founderId;
}

/** Falls back through the two legitimate reasons one traveler may write to another. */
async function sendRequest(sender, recipientId, message, element) {
  for (const source of ['trip_match', 'pin']) {
    try {
      const result = await rpc('send_message_request', sender.token, {
        p_recipient: recipientId,
        p_source: source,
        p_first_message: message,
        p_profile_element: element,
      });
      return { ...result, source };
    } catch (e) {
      if (/recipient unavailable/.test(e.message)) {
        continue;
      }
      throw e;
    }
  }
  return null;
}

async function ping(crew, founderId, skipSlug) {
  let recipient = founderId;
  const candidates = crew.filter((c) => c.slug !== skipSlug);

  // No id from an accept? Then the founder shows up as a trip overlap.
  const overlaps = new Map();
  for (const person of candidates) {
    const matches = await rpc('get_matches', person.token);
    const strangers = outsiders(matches ?? [], crew, 'user_id');
    if (strangers.length > 0) {
      overlaps.set(person.slug, strangers);
      recipient = recipient ?? strangers[0].user_id;
    }
  }
  if (!recipient) {
    console.log(
      '--   could not work out who to write to: add a trip in Lisbon or Bangkok (or drop a pin) and re-run'
    );
    return false;
  }

  // Someone who genuinely overlaps writes a better opener than a stranger.
  const sender = candidates.find((c) => overlaps.has(c.slug)) ?? candidates[0];
  const message =
    sender.pingMessage ??
    `Hey! Looks like we are in town the same days. I am putting something together this week if you feel like joining, no pressure either way.`;

  const result = await sendRequest(sender, recipient, message, 'bio');
  if (!result) {
    console.log(
      `--   ${sender.name} has no way to reach that account right now (no shared dates, no live pin)`
    );
    return false;
  }
  console.log(`\nok   ${sender.name} (${sender.city}) sent a request via ${result.source}`);
  console.log(`     "${message}"`);
  console.log(
    result.queued
      ? '     held for moderation, so it lands in the Chat tab within a minute or so'
      : result.delivered
        ? '     delivered: check the Chat tab'
        : '     blocked by the filter, which should not happen for this text'
  );
  return true;
}

const mode = process.argv[2] || 'both';
try {
  const crew = await signInAll();
  console.log(`signed in: ${crew.map((c) => c.name).join(', ')}\n`);

  let founderId = null;
  let accepterSlug = null;
  if (mode === 'accept' || mode === 'both') {
    founderId = await accept(crew);
    accepterSlug = founderId ? ACCEPTER : null;
  }
  if (mode === 'ping' || mode === 'both') {
    await ping(crew, founderId, accepterSlug);
  }
  if (!['accept', 'ping', 'both'].includes(mode)) {
    throw new Error('usage: demo-interactions.mjs accept|ping|both');
  }
  console.log('\ndone');
} catch (e) {
  console.error(`::error::${mode} failed: ${e.message}`);
  process.exit(1);
}
