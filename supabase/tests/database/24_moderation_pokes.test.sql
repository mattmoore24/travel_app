-- Moderation runs on the insert, not on the clock.
--
-- The wait people actually feel when they post a photo was almost all
-- scheduling: a cron that fires once a minute, and a chat-photo queue that
-- drained third of six. This suite guards the half of that fix which lives in
-- the database — the poke, its throttle, and the triggers that raise it —
-- and the view the app's "usually about N seconds" is only allowed to quote
-- from.
--
-- What it deliberately does NOT assert is that an HTTP request leaves. There
-- is no pg_net here (nor a vault), which is exactly why every path below has
-- to survive its absence: a photo that cannot be sent because the poke threw
-- would be far worse than a photo that waits for the cron.
begin;
select plan(22);

create function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  set local role anon;
end
$$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- THE THROTTLE TABLE --------------------------------------------------------

select has_table('public', 'worker_pokes', 'the poke throttle has a table');

select is(
  (select relrowsecurity from pg_class
    where oid = 'public.worker_pokes'::regclass),
  true,
  'with RLS on it like every other table in public'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'worker_pokes'
      and grantee in ('anon', 'authenticated')),
  0,
  'and nothing granted to anon or authenticated'
);

select is(
  has_function_privilege('anon', 'public.poke_worker(text)', 'execute'),
  false,
  'anon cannot poke a worker'
);

select is(
  has_function_privilege('authenticated', 'public.poke_worker(text)', 'execute'),
  false,
  'and neither can a signed-in caller'
);

-- THE THROTTLE ITSELF -------------------------------------------------------

select pg_temp.admin();
select lives_ok(
  $$ select public.poke_worker('moderation-worker') $$,
  'a poke survives having no pg_net and no vault to reach'
);

select is(
  (select count(*)::int from public.worker_pokes where worker = 'moderation-worker'),
  1,
  'and records that it happened'
);

-- Freeze what the first poke wrote, then poke again inside the window.
create temp table poke_state as
  select last_poked_at from public.worker_pokes where worker = 'moderation-worker';

select lives_ok(
  $$ select public.poke_worker('moderation-worker') $$,
  'a second poke a moment later is harmless'
);

select is(
  (select last_poked_at from public.worker_pokes where worker = 'moderation-worker'),
  (select last_poked_at from poke_state),
  'and is swallowed — six people pasting photos at once is one invocation'
);

-- Age the row past the window and the next one lands.
update public.worker_pokes
  set last_poked_at = now() - interval '1 minute'
  where worker = 'moderation-worker';
select public.poke_worker('moderation-worker');

select ok(
  (select last_poked_at from public.worker_pokes where worker = 'moderation-worker')
    > now() - interval '3 seconds',
  'once the window has passed, the next poke goes through'
);

select lives_ok(
  $$ select public.poke_worker('drop-table-worker') $$,
  'an unknown worker name is refused rather than interpolated'
);

select is(
  (select count(*)::int from public.worker_pokes where worker = 'drop-table-worker'),
  0,
  'and leaves no trace of having been asked'
);

-- THE TRIGGERS --------------------------------------------------------------
-- Checked as definitions rather than by inserting rows, because what is being
-- guarded is the CONDITION: a trigger that fires on every message insert
-- would poke the worker for every line of text anybody types.

select has_trigger('public', 'messages', 'messages_poke_moderation',
  'a chat photo pokes the worker');
select has_trigger('public', 'message_requests', 'message_requests_poke_moderation',
  'a held first message pokes the worker');
select has_trigger('public', 'profile_photos', 'profile_photos_poke_moderation',
  'a new profile photo pokes the worker');
select has_trigger('public', 'verification_requests', 'verification_requests_poke_moderation',
  'a selfie verification pokes the worker');

select matches(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgname = 'messages_poke_moderation'),
  'image_path IS NOT NULL',
  'and an ordinary text message does not'
);

select matches(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgname = 'messages_poke_moderation'),
  'AFTER INSERT',
  'the poke goes out after the row exists, not before'
);

-- THE NUMBER THE APP IS ALLOWED TO QUOTE ------------------------------------

select has_view('public', 'admin_moderation_latency',
  'the measured wait has somewhere to be read from');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'admin_moderation_latency'
      and grantee in ('anon', 'authenticated')),
  0,
  'and it is not readable from the app'
);

select pg_temp.admin();
select lives_ok(
  $$ select * from public.admin_moderation_latency $$,
  'it answers on an empty database rather than dividing by nothing'
);

-- One queued photo with no verdict yet must not count as a fast one.
insert into public.moderation_events (entity_type, entity_id, action, source)
values ('chat_photo', gen_random_uuid(), 'queued_for_llm', 'photo-pipeline');

select is(
  (select count(*)::int from public.admin_moderation_latency),
  0,
  'and an item still waiting is not counted as decided'
);

select * from finish();
rollback;
