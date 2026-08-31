// Integration tests against the LIVE Supabase project, exercising the same
// RPCs the app calls — including the moderation pipeline with a real Claude
// verdict, which as of writing has never screened real traffic.
//
// Anon key only, by design: these tests hold exactly the power a phone does,
// so anything they can do, any user can do. Test accounts are created fresh
// per run (RFC-2606 example.com addresses — undeliverable by definition) and
// destroyed via the delete-account Edge Function, which conveniently also
// exercises the App Review 5.1.1(v) deletion path for real.
//
// "Guest" means two different people in here, and the sections say which:
// a signed-out reader holding nothing but the anon key, and a guest ACCOUNT
// — an anonymous sign-in, which is a real authenticated user with
// is_anonymous set. The second one is the only part of this project that
// depends on a setting no migration can carry, so it is asserted rather than
// assumed.
//
// Env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY

import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error('::error::EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set');
  process.exit(1);
}

const RUN = Date.now().toString(36);
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`ok   ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each principal gets its own client: supabase-js holds one session per instance.
const newClient = () => createClient(URL_, KEY, { auth: { persistSession: false } });

// Hosted Supabase rejects RFC-2606 test domains ("Email address is
// invalid"), so test accounts plus-address a real inbox: valid by every
// validator, and if confirmation emails are ever enabled they land somewhere
// the owner of this project can read.
//
// Required, not defaulted. The only real inbox available to hard-code was a
// person's own, in a public repository. A missing secret is a five-second
// fix; quietly mailing a stranger is not.
const EMAIL_BASE = process.env.TEST_EMAIL_BASE;
if (!EMAIL_BASE || !EMAIL_BASE.includes('@')) {
  console.error(
    '::error::TEST_EMAIL_BASE is not set to an email address. Add it under ' +
      'Settings -> Secrets and variables -> Actions.'
  );
  process.exit(1);
}
const [EMAIL_USER, EMAIL_DOMAIN] = EMAIL_BASE.split('@');

async function signUpUser(tag) {
  const client = newClient();
  const email = `${EMAIL_USER}+sw-live-${RUN}-${tag}@${EMAIL_DOMAIN}`;
  const password = `Test-${RUN}-${tag}-pw1`;
  let { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new Error(`signUp(${tag}): ${error.message}`);
  if (!data.session) {
    // Email confirmations are ON. The app's own auth flow would hit this
    // wall too, so surface it as a finding rather than working around it.
    throw new Error(
      `signUp(${tag}) returned no session — email confirmation appears to be ` +
        'REQUIRED on this project. Real sign-ups face the same wall; decide: ' +
        'disable confirmations for v1, or wire deep-linked confirmation emails.'
    );
  }
  return { client, email, userId: data.user.id, tag };
}

async function onboard(u, { name, city }) {
  const { error } = await u.client
    .from('profiles')
    .update({
      display_name: name,
      age: 27,
      home_city: 'Testville',
      home_country: 'US',
      languages: ['en'],
      bio: 'Live integration test account. If you can read this in prod, tell the founder.',
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('user_id', u.userId);
  if (error) throw new Error(`onboard(${u.tag}): ${error.message}`);

  const { data: cities, error: cErr } = await u.client.rpc('search_cities', { p_query: city });
  if (cErr) throw new Error(`search_cities(${u.tag}): ${cErr.message}`);
  const lisbon = (cities ?? []).find((c) => c.name === city);
  if (!lisbon) throw new Error(`city ${city} not found`);

  const today = new Date();
  const d = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  const { error: tErr } = await u.client
    .from('trips')
    .insert({ user_id: u.userId, city_id: lisbon.id, start_date: d(2), end_date: d(9) });
  if (tErr) throw new Error(`trip(${u.tag}): ${tErr.message}`);
  return lisbon.id;
}

async function pollIncoming(u, { until, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const { data, error } = await u.client.rpc('incoming_requests');
    if (error) throw new Error(`incoming_requests(${u.tag}): ${error.message}`);
    last = data ?? [];
    if (until(last)) return last;
    await sleep(10000);
  }
  return last;
}

const users = [];
try {
  // --- accounts + matching ------------------------------------------------
  const alex = await signUpUser('alex');
  const brit = await signUpUser('brit');
  const creep = await signUpUser('creep');
  users.push(alex, brit, creep);
  check('three fresh accounts sign up and hold sessions', true);

  const lisbonId = await onboard(alex, { name: 'Alex Live', city: 'Lisbon' });
  await onboard(brit, { name: 'Brit Live', city: 'Lisbon' });
  await onboard(creep, { name: 'Casey Live', city: 'Lisbon' });
  check('onboarding writes profiles and overlapping Lisbon trips', true);

  const { data: handles, error: hErr } = await alex.client
    .from('social_handles')
    .insert({ user_id: alex.userId, platform: 'instagram', handle: `sw_live_${RUN}` })
    .select();
  check('sender adds a social handle', !hErr && handles?.length === 1, hErr?.message);

  const { data: matches, error: mErr } = await brit.client.rpc('get_matches');
  const seesAlex = (matches ?? []).some((m) => m.user_id === alex.userId);
  check('overlapping trips match (14-day window logic, live)', !mErr && seesAlex, mErr?.message);

  // --- hard rule 4: handles invisible pre-accept --------------------------
  const { data: preHandles } = await brit.client
    .from('social_handles')
    .select('*')
    .eq('user_id', alex.userId);
  check('social handles are INVISIBLE pre-accept (RLS, live)', (preHandles ?? []).length === 0);

  // --- hard rule 5: clean message held, then delivered --------------------
  const { error: sendErr } = await alex.client.rpc('send_message_request', {
    p_recipient: brit.userId,
    p_source: 'trip_match',
    p_first_message: 'Hey! I am also in Lisbon next week — up for the Time Out Market?',
    p_profile_element: null,
  });
  check('clean first message accepted by send_message_request', !sendErr, sendErr?.message);

  const incoming = await pollIncoming(brit, {
    until: (rows) => rows.some((r) => r.sender_id === alex.userId),
    timeoutMs: 300000,
  });
  const cleanRow = incoming.find((r) => r.sender_id === alex.userId);
  check(
    'clean message RELEASED by live Claude moderation within 5 min',
    Boolean(cleanRow),
    'held forever = worker/key problem; check worker_status() and Edge Function logs'
  );

  // --- hard rule 5: flirty message never arrives --------------------------
  const { error: flirtErr } = await creep.client.rpc('send_message_request', {
    p_recipient: brit.userId,
    p_source: 'trip_match',
    p_first_message:
      'You are absolutely gorgeous. Are you single? I would love to take you out on a romantic date, just the two of us.',
    p_profile_element: null,
  });
  // Either the regex pre-filter rejects it at the door, or it is held and the
  // classifier blocks it. Both are correct; delivery is the only failure.
  if (flirtErr) {
    check('flirty first message rejected at the door (pre-filter)', true);
  } else {
    await sleep(240000);
    const { data: after } = await brit.client.rpc('incoming_requests');
    const leaked = (after ?? []).some((r) => r.sender_id === creep.userId);
    check(
      'flirty first message NEVER delivered (live classifier verdict)',
      !leaked,
      'IT WAS DELIVERED — moderation pipeline is not enforcing'
    );
  }

  // --- accept -> chat -> handles become visible ---------------------------
  if (cleanRow) {
    const { data: resp, error: rErr } = await brit.client.rpc('respond_to_message_request', {
      p_request_id: cleanRow.id,
      p_accept: true,
    });
    check('accept creates a chat', !rErr && Boolean(resp?.chat_id), rErr?.message);

    const { data: postHandles } = await brit.client
      .from('social_handles')
      .select('*')
      .eq('user_id', alex.userId);
    check('social handles VISIBLE post-accept', (postHandles ?? []).length === 1);

    if (resp?.chat_id) {
      const { error: msgErr } = await brit.client.from('messages').insert({
        chat_id: resp.chat_id,
        sender_id: brit.userId,
        body: 'Sounds great, see you there!',
      });
      check('chat reply sends', !msgErr, msgErr?.message);
    }
  }

  // --- guest surfaces -----------------------------------------------------
  const guest = newClient();
  const { data: guestCities, error: gcErr } = await guest.rpc('search_cities', {
    p_query: 'Lisbon',
  });
  const guestLisbon = (guestCities ?? []).find((c) => c.name === 'Lisbon');
  check('guest can search cities', !gcErr && Boolean(guestLisbon), gcErr?.message);
  if (guestLisbon) {
    const { data: pins, error: pinErr } = await guest.rpc('public_city_pins', {
      p_city_id: guestLisbon.id,
    });
    check(
      'guest reads public pins with no identity attached',
      !pinErr && (pins ?? []).every((x) => !('user_id' in x)),
      pinErr?.message
    );
    // The curated-pin copy rule, proven on the LIVE rows a traveler reads:
    // 20260830030000 rewrote the sixteen seeded notes and swept the
    // already-seeded ones, and only this surface shows whether the sweep ran
    // where it matters. Every visible text field rides in — the rule is "no
    // em dash reaches a map", not "no em dash survives in one column".
    const seededPins = (pins ?? []).filter((x) => x.seeded);
    check(
      'curated pins are live and no visible pin text holds an em dash',
      seededPins.length > 0 &&
        (pins ?? []).every(
          (x) =>
            !`${x.venue_name ?? ''}${x.note ?? ''}${x.seed_note ?? ''}${x.place_label ?? ''}`.includes(
              '—'
            )
        ),
      `${seededPins.length} seeded of ${(pins ?? []).length} pins`
    );
  }
  const { data: guestProfiles } = await guest.from('profiles').select('*').limit(1);
  check('guest CANNOT read profiles table', (guestProfiles ?? []).length === 0);

  // --- guest ACCOUNTS: the anonymous sign-in path -------------------------
  //
  // Distinct from the signed-out reads above: this is somebody who was handed
  // a link in a lobby, typed a name, and is now a real `authenticated` user
  // with is_anonymous set. Worth testing HERE and not only in pgTAP for one
  // reason the pgTAP cluster structurally cannot cover — anonymous sign-in is
  // GoTrue configuration, not schema. It is a dashboard switch, it is not in
  // any migration, and nothing else in this repository would notice it being
  // off. The whole feature is a dead button until it is on, so the first
  // assertion below is the one that matters.
  const sam = newClient();
  const { data: anon, error: anonErr } = await sam.auth.signInAnonymously();
  const samIsGuest = anon?.user?.is_anonymous === true;
  check(
    'anonymous sign-in is ENABLED on the project',
    !anonErr && Boolean(anon?.session) && samIsGuest,
    anonErr?.message ??
      'no anonymous session. Authentication -> Sign In / Providers -> Anonymous sign-ins'
  );

  if (samIsGuest) {
    const samId = anon.user.id;
    // Registered for teardown immediately, before anything can throw: an
    // abandoned anonymous account would otherwise sit in the project until
    // the janitor's 30-day sweep.
    users.push({ client: sam, tag: 'sam(guest)', userId: samId, email: null });

    const { data: samName, error: nameErr } = await sam.rpc('set_guest_name', {
      p_name: `Sam Live ${RUN}`,
    });
    check('a guest names themselves', !nameErr && Boolean(samName), nameErr?.message);

    // The load-bearing refusal. onboarding_completed_at sits inside the
    // client's own UPDATE grant and every discovery surface keys on it, so
    // without the trigger a guest could type a name and make themselves
    // browsable to strangers.
    const { error: stampErr } = await sam
      .from('profiles')
      .update({ onboarding_completed_at: new Date().toISOString(), age: 30 })
      .eq('user_id', samId);
    check(
      'a guest CANNOT stamp themselves onboarded (live trigger)',
      Boolean(stampErr),
      'IT WAS ACCEPTED — a nameless account can reach the Travelers queue'
    );

    if (guestLisbon) {
      const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
      const { error: tripErr } = await sam
        .from('trips')
        .insert({ user_id: samId, city_id: guestLisbon.id, start_date: day(2), end_date: day(6) });
      check('and posts no trips, which is what would match them', Boolean(tripErr));
    }

    // The bug the founder actually hit: a friend tapped an invite link while
    // signed out and was told it could not load. The preview was
    // authenticated-only, so the signed-out branch behind it was unreachable
    // code. `guest` here is the SIGNED-OUT client, deliberately.
    const { data: groupId, error: groupErr } = await alex.client.rpc('create_group', {
      p_name: `Live crew ${RUN}`,
      p_max_stay_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    });
    check('a member starts a group', !groupErr && Boolean(groupId), groupErr?.message);

    if (groupId) {
      const { data: token, error: tokErr } = await alex.client.rpc('group_invite_token', {
        p_chat_id: groupId,
      });
      check('and gets a link for it', !tokErr && Boolean(token), tokErr?.message);

      if (token) {
        const { data: signedOutPreview, error: soErr } = await guest.rpc('group_invite_preview', {
          p_token: token,
        });
        check(
          'an invite link opens while SIGNED OUT',
          !soErr && (signedOutPreview ?? []).length === 1,
          soErr?.message ?? 'the preview is empty — this is the "invite could not load" bug'
        );
        check(
          'and shows no photo path to somebody outside the group',
          (signedOutPreview ?? [])[0]?.photo_path == null
        );

        const { data: joined, error: joinErr } = await sam.rpc('join_group_with_invite', {
          p_token: token,
          p_stay_until: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        });
        check(
          'a guest holding the link joins the group',
          !joinErr && Boolean(joined?.chat_id),
          joinErr?.message
        );

        if (joined?.chat_id) {
          const { error: sayErr } = await sam
            .from('messages')
            .insert({ chat_id: joined.chat_id, sender_id: samId, body: 'just checked in, hi all' });
          check('and can answer the room', !sayErr, sayErr?.message);

          const { error: photoErr } = await sam.from('messages').insert({
            chat_id: joined.chat_id,
            sender_id: samId,
            body: 'look',
            image_path: `${samId}/x.jpg`,
          });
          check(
            'but sends no photos, so a free identity never reaches the classifier',
            Boolean(photoErr)
          );

          // The promise the whole mechanism was chosen for. GoTrue clears
          // is_anonymous on the SAME auth row when an email is added, so
          // there is no data move: the room and the words are already theirs.
          const samEmail = `${EMAIL_USER}+sw-live-${RUN}-sam@${EMAIL_DOMAIN}`;
          const { data: upgraded, error: upErr } = await sam.auth.updateUser({
            email: samEmail,
            password: `Test-${RUN}-sam-pw1`,
          });
          const converted = !upErr && upgraded?.user?.is_anonymous === false;
          check('a guest becomes a member on the same auth row', converted, upErr?.message);

          if (converted) {
            users[users.length - 1].email = samEmail;
            const { data: stillIn } = await sam
              .from('messages')
              .select('id')
              .eq('chat_id', joined.chat_id)
              .eq('sender_id', samId);
            check(
              'keeping the chat they joined and what they said in it',
              (stillIn ?? []).length === 1
            );

            // And the refusals lift in the same statement that converted them.
            const { error: nowErr } = await sam
              .from('profiles')
              .update({ onboarding_completed_at: new Date().toISOString(), age: 28 })
              .eq('user_id', samId);
            check('and can now finish a real profile', !nowErr, nowErr?.message);
          }
        }
      }
    }
  }

  // --- the contact form ---------------------------------------------------
  // The app's only published way to reach a human, and App Review exercises
  // it. A guest must get through (somebody who cannot sign in is exactly the
  // person who needs support), the sender must be able to ask what became of
  // their own message, and nobody else must be able to.
  const supportBody =
    `Automated canary from the live backend suite (run ${RUN}). ` +
    'Nothing is wrong; this proves the contact form still reaches a human.';
  const { data: guestSupportId, error: guestSupportErr } = await guest.rpc(
    'submit_support_message',
    { p_reply_to: `${EMAIL_USER}+sw-support-${RUN}@${EMAIL_DOMAIN}`, p_body: supportBody }
  );
  check(
    'a guest can reach support and gets an id back',
    !guestSupportErr && Boolean(guestSupportId),
    guestSupportErr?.message
  );

  const { data: mineId, error: mineErr } = await brit.client.rpc('submit_support_message', {
    p_reply_to: `${EMAIL_USER}+sw-support-${RUN}-b@${EMAIL_DOMAIN}`,
    p_body: supportBody,
  });
  check('a signed-in traveler can too', !mineErr && Boolean(mineId), mineErr?.message);

  if (mineId) {
    const { data: status, error: statusErr } = await brit.client.rpc('support_message_status', {
      p_id: mineId,
    });
    check(
      'the sender can ask what became of their own message',
      !statusErr && (status ?? []).length === 1,
      statusErr?.message
    );
    // Delivery is a cron job on a five-minute tick, so this run is almost
    // certainly too early to see it. Reported, never asserted: a slow mailer
    // is not a broken contact form.
    console.log(
      `note delivered_at at this instant: ${JSON.stringify((status ?? [])[0]?.delivered_at ?? null)}`
    );

    const { data: notMine } = await alex.client.rpc('support_message_status', { p_id: mineId });
    check('and nobody else can, even naming the id exactly', (notMine ?? []).length === 0);
  }

  const { data: supportRows } = await brit.client.from('support_messages').select('*').limit(1);
  check('the support inbox itself stays unreadable', (supportRows ?? []).length === 0);

  // DECLARED DEVIATION: no live case for "a suspended account can still
  // appeal".
  //
  // The spec for acct-a-way-back-from-the-gate asked for one here, and this
  // suite cannot write it. `users.status` is server-owned - stripped from
  // every client column grant, with no policy that would let a client set it
  // - so with the anon key, which is the whole contract of this file ("these
  // tests hold exactly the power a phone does"), there is no way to suspend
  // an account and no way to lift it afterwards. The by-hand alternative the
  // spec pairs with the screenshot step (suspend a test account from the SQL
  // editor) needs the service role, and a failed run would leave a suspended
  // row behind on the live project with nothing in this file able to undo it.
  //
  // What stands in for it: the "THE APPEAL ROUTE" block in
  // supabase/tests/database/11_groups_support.test.sql, which suspends a real
  // user, calls submit_support_message as that user, bans them, and calls it
  // again. The claim is a negative about a policy - support_messages_insert
  // checks authorship and nothing else, so there is no standing check on the
  // one insert the whole appeal route runs through - and a policy claim is
  // what pgTAP is for. The screenshot half of the spec still needs a person.
  console.log(
    'note DEVIATION: the suspended-account appeal is not asserted here (no ' +
      'anon-key way to suspend an account); covered by pgTAP ' +
      '11_groups_support.test.sql, "THE APPEAL ROUTE"'
  );

  // --- the spotlight cannot reach past a block ----------------------------
  //
  // Worth doing HERE rather than only in pgTAP. daily_spotlight() is SECURITY
  // DEFINER and calls get_matches(), which is SECURITY INVOKER and does none
  // of its own filtering: every check lives in the trips_select_overlap
  // policy, and policies do not run for a definer. The local test cluster
  // owns its tables with a nosuperuser, nobypassrls role; hosted Supabase's
  // `postgres` additionally has BYPASSRLS, which is the very condition that
  // makes the bypass total. So this is the one place the fix can actually be
  // proven under the roles it will run under.
  //
  // Casey blocks Alex, and Alex is the one asking. Casey and Alex overlap in
  // Lisbon, so without the restated filters Casey is a legitimate candidate.
  const { error: blockErr } = await creep.client
    .from('blocks')
    .insert({ blocker_id: creep.userId, blocked_id: alex.userId });
  check('a block is written', !blockErr, blockErr?.message);

  const { data: spotlight, error: spotErr } = await alex.client.rpc('daily_spotlight');
  const spotlightedByBlocker = (spotlight ?? []).some((r) => r.user_id === creep.userId);
  check(
    'the daily spotlight never surfaces somebody who blocked you (live)',
    !spotErr && !spotlightedByBlocker,
    spotErr?.message
  );

  // --- PLACES: the whole 2026-08-27 surface, against the real project -----
  //
  // pgTAP proves this schema against a local cluster whose `postgres` role is
  // NOSUPERUSER and NOBYPASSRLS and which has no Supabase default privileges
  // on it. Hosted Supabase differs in exactly the ways that break a places
  // feature: `authenticated` gets default grants a migration did not ask for,
  // a DROP FUNCTION silently re-grants EXECUTE to anon, and column-scoped
  // SELECT grants behave differently from a table-wide one the moment a
  // client names a column in a WHERE. So every RPC below is called the way
  // the app calls it, with anon-key power only.
  const { data: places, error: placesErr } = await guest.rpc('city_businesses', {
    p_city_id: lisbonId,
  });
  const homeLisbon = (places ?? []).find((p) => p.name === 'Home Lisbon Hostel');
  check(
    'a signed-out reader sees the places on a city map',
    !placesErr && Boolean(homeLisbon),
    placesErr?.message ?? 'no Home Lisbon Hostel — run seed_launch_businesses()'
  );

  // The columns a place row must NOT carry. `state` is the moderation queue,
  // `owner_user_id` is a person, and either one on the public map is a leak
  // that no client-side omission can take back.
  if (homeLisbon) {
    check(
      'and the row it gets carries no moderation state and no owner',
      !('state' in homeLisbon) && !('owner_user_id' in homeLisbon),
      `leaked: ${Object.keys(homeLisbon).join(', ')}`
    );
  }

  if (homeLisbon) {
    const placeId = homeLisbon.id;

    const { data: detail, error: detailErr } = await guest.rpc('business_detail', {
      p_business_id: placeId,
    });
    check(
      'the place page loads for somebody with no account',
      !detailErr && (detail ?? []).length === 1,
      detailErr?.message
    );

    // --- ratings. Anyone may rate: the founder's call, on the grounds that
    // somebody may have been there without ever entering the trip here.
    const { error: rateErr } = await alex.client.rpc('rate_business', {
      p_business_id: placeId,
      p_bucket: 'loved',
      p_rank: 0.5,
      p_tags: ['good_for_meeting_people', 'cheap'],
    });
    check('a traveler rates a place they never posted a trip for', !rateErr, rateErr?.message);

    const { data: mine, error: mineRateErr } = await alex.client.rpc('my_ratings', {
      p_category: 'hostel',
    });
    check(
      'and it comes straight back on their own list',
      !mineRateErr && (mine ?? []).some((r) => r.business_id === placeId),
      mineRateErr?.message
    );

    const { data: top, error: topErr } = await brit.client.rpc('top_rated_by', {
      p_user_id: alex.userId,
    });
    check(
      'another traveler can see what they loved',
      !topErr && (top ?? []).some((r) => r.business_id === placeId),
      topErr?.message
    );

    // The k-threshold, in the same spirit as the heatmap's: one person's
    // opinion is not a public score, so below five raters the number is null
    // rather than small. This run contributes at most three.
    const { data: summary, error: sumErr } = await guest.rpc('business_rating_summary', {
      p_business_id: placeId,
    });
    const row = (summary ?? [])[0];
    check(
      'a public score stays null until enough people have rated',
      !sumErr && row != null && (row.rater_count >= 5 || row.average == null),
      sumErr?.message ?? `average ${row?.average} on ${row?.rater_count} raters`
    );

    // A rank outside the bucket is the client's job to compute; the server
    // must not take it on trust.
    const { error: badRankErr } = await brit.client.rpc('rate_business', {
      p_business_id: placeId,
      p_bucket: 'fine',
      p_rank: 4,
    });
    check('and a rank outside the window is refused', Boolean(badRankErr));

    // --- messaging a place NOBODY runs.
    //
    // Run 14 failed here, and the failure was this test's assumption rather
    // than the app's behaviour: the four launch venues are seeded with
    // owner_user_id null, and message_business refuses them outright. That
    // refusal is correct and it is the thing worth proving live — a chat
    // opened into the void is worse than a plain no.
    //
    // The bug the refusal exposed was on the CLIENT, which offered Message
    // anyway and only found out after five hundred characters had been typed
    // and Send pressed. The fix is `claimed`, asserted below: it is the field
    // the place page and the map sheet now read to decide whether to draw the
    // button at all. There is no claimed AND listed business in this run to
    // send a real message to — claiming one needs an email code out of an
    // inbox — so the send path stays covered by pgTAP suite 23.
    const detailRow = (detail ?? [])[0];
    check(
      'the place page says whether anybody runs it',
      detailRow != null && detailRow.claimed === false,
      `claimed: ${JSON.stringify(detailRow?.claimed)}`
    );

    const { error: msgErr } = await alex.client.rpc('message_business', {
      p_business_id: placeId,
      p_first_message: `Live canary ${RUN}: is the roof open tonight?`,
    });
    check(
      'and writing to a place nobody runs is refused, not opened into the void',
      Boolean(msgErr) && /nobody runs this business/i.test(msgErr.message),
      msgErr?.message ?? 'IT WAS ACCEPTED'
    );

    // --- reports. One voice per account, enforced by a partial unique index
    // rather than by the client remembering.
    const { error: reportErr } = await brit.client.rpc('report_business', {
      p_business_id: placeId,
      p_reason: 'not_this_business',
      p_note: `Live canary ${RUN}. Not a real report; ignore.`,
    });
    check('a traveler can report a listing', !reportErr, reportErr?.message);

    // ON CONFLICT DO NOTHING against the partial unique index, so a second
    // report from the same account succeeds and changes nothing. The client
    // says "we've got it" either way, which is the behaviour worth having:
    // somebody who taps twice must not be shown an error for it.
    const { error: report2Err } = await brit.client.rpc('report_business', {
      p_business_id: placeId,
      p_reason: 'not_a_real_place',
    });
    check(
      'and reporting it a second time is quietly folded in, not an error',
      !report2Err,
      report2Err?.message
    );

    const { data: reportRows } = await brit.client.from('business_reports').select('*').limit(1);
    check('the report queue itself stays unreadable', (reportRows ?? []).length === 0);
  }

  // --- a place's own account ---------------------------------------------
  //
  // register_business is EXECUTE-revoked from anon, and refuses an account
  // that has finished traveler onboarding: the two kinds must never share an
  // auth row, because every guard downstream asks that one question.
  const { error: anonRegErr } = await guest.rpc('register_business', {
    p_name: `Anon Bar ${RUN}`,
    p_category: 'bar',
    p_city_id: lisbonId,
    p_lat: 38.71,
    p_lng: -9.14,
  });
  check('a signed-out reader cannot register a place', Boolean(anonRegErr));

  const { error: travelerRegErr } = await alex.client.rpc('register_business', {
    p_name: `Alex Bar ${RUN}`,
    p_category: 'bar',
    p_city_id: lisbonId,
    p_lat: 38.71,
    p_lng: -9.14,
  });
  check('a traveler cannot turn into a place', Boolean(travelerRegErr));

  // A fresh account that never onboarded as a traveler is what a real owner
  // is. Registered for teardown before anything can throw.
  const owner = await signUpUser('owner');
  users.push(owner);
  const { data: bizId, error: regErr } = await owner.client.rpc('register_business', {
    p_name: `Canary Bar ${RUN}`,
    p_category: 'bar',
    p_city_id: lisbonId,
    p_lat: 38.7123,
    p_lng: -9.1399,
  });
  check('somebody who runs a bar can claim it', !regErr && Boolean(bizId), regErr?.message);

  if (bizId) {
    const { data: mineBiz, error: mineBizErr } = await owner.client.rpc('my_business');
    const biz = (mineBiz ?? [])[0];
    check(
      'and reads their own place back, unverified and unlisted',
      !mineBizErr && biz?.id === bizId && biz?.state === 'unconfirmed' && biz?.verified === false,
      mineBizErr?.message ?? JSON.stringify(biz)
    );

    // §7 rule 3 in the other direction: a place is not a traveler, so it may
    // not drop a 72-hour pin or post a trip. Six triggers enforce it; two
    // are worth proving under the live roles.
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const { error: bizTripErr } = await owner.client
      .from('trips')
      .insert({ user_id: owner.userId, city_id: lisbonId, start_date: day(2), end_date: day(5) });
    check('a place cannot post a trip', Boolean(bizTripErr));

    // Every column filled and every check satisfied, so the only thing left
    // to refuse it is the trigger under test. A short row would have been
    // rejected for a missing column and passed this assertion for the wrong
    // reason, which is worse than no assertion.
    const { error: bizPinErr } = await owner.client.from('pins').insert({
      user_id: owner.userId,
      city_id: lisbonId,
      venue_name: `Canary ${RUN}`,
      category: 'bar',
      lat: 38.7123,
      lng: -9.1399,
      intent_date: day(0),
      expires_at: new Date(Date.now() + 12 * 3600000).toISOString(),
    });
    check('a place cannot drop a traveler pin', Boolean(bizPinErr));

    // The listing email. The code itself goes out by mail and is stored only
    // as a hash, so a test can prove the request is accepted and that a wrong
    // code is refused — which is the half that matters.
    const { error: confReqErr } = await owner.client.rpc('request_business_email_confirmation', {
      p_email: `${EMAIL_USER}+sw-biz-${RUN}@${EMAIL_DOMAIN}`,
    });
    check('a place can ask for a confirmation code', !confReqErr, confReqErr?.message);

    // Asserting on the MESSAGE, not merely on failure: "ask for a code first"
    // would also be an error, and would mean the request above had silently
    // done nothing while this line reported success.
    const { data: wrong, error: wrongErr } = await owner.client.rpc('confirm_business_email', {
      p_code: '000000',
    });
    check(
      'and a code somebody guessed is refused, as a wrong code and not a missing one',
      Boolean(wrongErr) && /not right/i.test(wrongErr.message),
      wrongErr?.message ?? `it was ACCEPTED: ${JSON.stringify(wrong)}`
    );

    // The map must not carry an unconfirmed place. This is the single most
    // load-bearing assertion in the section: it is the difference between a
    // listing directory and an open door for anyone with an email address.
    const { data: afterReg } = await guest.rpc('city_businesses', { p_city_id: lisbonId });
    check('an unconfirmed place is NOT on the map', !(afterReg ?? []).some((p) => p.id === bizId));
  }

  // --- top priorities -----------------------------------------------------
  //
  // Six is the PRIMARY KEY (user_id, slot) with a 0-5 check, not a client
  // rule, and the text is screened by the same trigger as a first message.
  const priorityRows = Array.from({ length: 6 }, (_, slot) => ({
    user_id: alex.userId,
    slot,
    text: `live canary plan ${slot}`,
  }));
  const { error: prioErr } = await alex.client.from('profile_priorities').insert(priorityRows);
  check('a traveler writes six top priorities', !prioErr, prioErr?.message);

  const { error: seventhErr } = await alex.client
    .from('profile_priorities')
    .insert({ user_id: alex.userId, slot: 6, text: 'one too many' });
  check('and a seventh is refused by the database, not by the app', Boolean(seventhErr));

  const { data: seen, error: seenErr } = await brit.client
    .from('profile_priorities')
    .select('slot, text')
    .eq('user_id', alex.userId);
  check(
    'somebody who can see the profile can see the list',
    !seenErr && (seen ?? []).length === 6,
    seenErr?.message ?? `${(seen ?? []).length} rows`
  );

  const { error: theirsErr } = await brit.client
    .from('profile_priorities')
    .insert({ user_id: alex.userId, slot: 0, text: 'not yours to write' });
  check('but cannot write into it', Boolean(theirsErr));

  // --- a capped answer is shaped like every other answer ------------------
  //
  // The client has ONE result type for send_message_request, so a branch that
  // omits a key types it as present and hands back undefined.
  const { data: capShape, error: capErr } = await alex.client.rpc('first_message_budget');
  check(
    'the hello budget reads back with both halves',
    !capErr &&
      typeof capShape?.[0]?.used === 'number' &&
      typeof capShape?.[0]?.allowed === 'number',
    capErr?.message
  );

  // --- the Apple refresh token is server-only, in production too ----------
  //
  // apple_refresh_tokens holds a credential against somebody's Apple account,
  // kept only so delete-account can revoke it. pgTAP proves the grants on a
  // throwaway cluster; this proves the deployed project agrees, from a client
  // holding exactly what a phone holds. A signed-in user must not be able to
  // read it, not even their own row.
  const { data: appleRows, error: appleErr } = await alex.client
    .from('apple_refresh_tokens')
    .select('user_id');
  check(
    'apple_refresh_tokens is unreadable with an anon key',
    Boolean(appleErr) && (appleRows ?? []).length === 0,
    appleErr ? '' : 'the table answered a client'
  );
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e.message}`);
} finally {
  // Destroy the test accounts through the same Edge Function the app's
  // "Delete account" button calls — cleanup and a live 5.1.1(v) test in one.
  for (const u of users) {
    try {
      const { error } = await u.client.functions.invoke('delete-account');
      check(`delete-account destroys ${u.tag}`, !error, error?.message);
    } catch (e) {
      check(`delete-account destroys ${u.tag}`, false, e.message);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
