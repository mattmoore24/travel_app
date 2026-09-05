-- A business link cannot hide where it goes.
--
-- The attack on 20260903090000. validate_business_link used to apply its
-- IP-literal check inside the generic `else` branch only, so the four social
-- kinds took a bare address without complaint, and it had never heard of a
-- shortener. Every assertion below is a link the client would already warn a
-- reader about (src/features/business/links.ts linkCaution) and the database
-- used to accept.
--
-- The inserts run as the table owner: the trigger fires whoever writes the
-- row, and what is under test is the trigger, not the owner's RLS.
--
-- Measured (2026-09-02) against the migration with the shortener block
-- deleted: assertions 1 to 6 and 14 fail, and 17 with them - not because a
-- Facebook link is refused, but because the six shorteners then SAVE and
-- the fixture hits the ten-link cap before the last insert. With the host
-- check skipped for the four social kinds (the previous definition's shape):
-- 2, 7 to 10 and 15 fail; 11 stands because 'tickets' was always in the
-- checked branch. With the hint dropped from the shortener raise: 14 alone.
begin;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d3b1', 'hostel@example.com');

update public.profiles set
  display_name = 'Casa Azul', age = 30, home_country = 'PT',
  languages = array['en'], onboarding_completed_at = now();

create function pg_temp.biz() returns uuid language sql as
  $$ select id from public.businesses where name = 'Casa Azul' $$;

/** The hint a refused insert carries, or null when it was not refused. */
create function pg_temp.hint_of(p_kind text, p_value text) returns text
language plpgsql as $$
declare
  v_hint text;
begin
  insert into public.business_links (business_id, kind, label, value)
  values (pg_temp.biz(), p_kind::public.business_link_kind, 'Us', p_value);
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end
$$;

insert into public.businesses (city_id, name, category, lat, lng, owner_user_id, state)
values ((select id from public.cities where name = 'Lisbon' and country_code = 'PT'),
        'Casa Azul', 'hostel', 38.7108, -9.1400,
        '00000000-0000-0000-0000-00000000d3b1', 'listed');

-- A SHORTENER IS REFUSED, ON EVERY KIND THAT CARRIES A URL ------------------

select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'website', 'Us', 'https://bit.ly/x3f9') $$,
  'use the real address, not a short link',
  'https://bit.ly/x is refused as a website'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'instagram', 'Us', 'https://bit.ly/x3f9') $$,
  'use the real address, not a short link',
  'and as an Instagram link, which the label would otherwise vouch for'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'reservations', 'Book', 'https://tinyurl.com/casa') $$,
  'use the real address, not a short link',
  'tinyurl on a booking link too: the list is the client''s, not one host'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'website', 'Us', 'https://www.bit.ly/x3f9') $$,
  'use the real address, not a short link',
  'a subdomain of a shortener is the same shortener'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'website', 'Us', 'https://casaazul.example@bit.ly/x3f9') $$,
  'use the real address, not a short link',
  'and userinfo in front of it does not make the host casaazul.example'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'menu', 'Menu', 'https://BIT.LY/x3f9') $$,
  'use the real address, not a short link',
  'case does not help either'
);

-- A BARE ADDRESS IS REFUSED ON EVERY KIND, NOT ONLY THE GENERIC ONE ---------

select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'instagram', 'Us', 'https://1.2.3.4/x') $$,
  'that link needs a real domain',
  'https://1.2.3.4/x is refused as an Instagram link'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'tiktok', 'Us', 'https://1.2.3.4/x') $$,
  'that link needs a real domain',
  'as a TikTok link'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'facebook', 'Us', 'https://1.2.3.4/x') $$,
  'that link needs a real domain',
  'as a Facebook link'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'x', 'Us', 'https://1.2.3.4:8443/x') $$,
  'that link needs a real domain',
  'as an X link, with a port in the way'
);
select throws_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'tickets', 'Tickets', 'https://[2001:db8::1]/x') $$,
  'that link needs a real domain',
  'and a bracketed IPv6 literal is a bare address as well'
);

-- A REAL ADDRESS STILL SAVES --------------------------------------------------

select lives_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'website', 'Us', 'https://casaazul.example/menu') $$,
  'a plain menu URL saves'
);
select lives_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'instagram', 'Us', '@casaazul') $$,
  'a bare handle has no host and is left alone'
);
select is(
  pg_temp.hint_of('website', 'https://bit.ly/x3f9'),
  'short_link',
  'the refusal carries the hint code the client maps to a sentence'
);
select is(
  pg_temp.hint_of('instagram', 'https://1.2.3.4/x'),
  'bare_address',
  'and so does the bare-address one'
);
select lives_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'phone', 'Call', '+351 21 000 0000') $$,
  'a phone number is not a web address and the host check leaves it alone'
);
select lives_ok(
  $$ insert into public.business_links (business_id, kind, label, value)
     values (pg_temp.biz(), 'facebook', 'Us', 'https://facebook.com/casaazul') $$,
  'a social link on its own platform saves'
);

-- THE TRIGGER FUNCTION IS NOBODY'S TO CALL ------------------------------------
select ok(
  not has_function_privilege('anon', 'public.validate_business_link()', 'execute')
  and not has_function_privilege('authenticated', 'public.validate_business_link()', 'execute'),
  'the revoke survived the restate'
);

-- AND THE SERVER'S LIST IS THE LIST IT IS SUPPOSED TO BE.
--
-- Read what this does and does not do. Postgres cannot open
-- src/features/business/links.ts, so this assertion compares the installed
-- function against a literal typed HERE: it catches a shortener quietly
-- dropped from `v_short`, or the array reordered, and it says nothing at all
-- about whether links.ts still holds the same nine. It used to claim it did
-- ("the list has to match ... SHORT_LINK_HOSTS"), and it did not: editing
-- SHORT_LINK_HOSTS failed nothing, anywhere.
--
-- The cross-language half now lives where it can read both files, in jest:
-- src/features/business/__tests__/links.test.ts, "the shortener denylist is
-- one list in three places", which reads SHORT_LINK_HOSTS, `v_short` out of
-- the newest migration that defines the function, and the literal below, and
-- fails by name when any one of the three moves without the others.
--
-- Note also what the whole-file mutation record above does NOT cover: with
-- the shortener block deleted but `v_short` left declared, 1 to 6, 14 and 17
-- fail and THIS assertion still passes, because the array is still in the
-- function definition. It pins the list, never the branch that reads it -
-- assertions 1 to 6 are what hold that.
select matches(
  pg_get_functiondef('public.validate_business_link()'::regprocedure),
  $$'bit\.ly',\s*'tinyurl\.com',\s*'t\.co',\s*'is\.gd',\s*'goo\.gl',\s*'rb\.gy',\s*'cutt\.ly',\s*'shorturl\.at',\s*'ow\.ly'$$,
  'the server''s array still names the nine hosts, in that order'
);

select * from finish();
rollback;
