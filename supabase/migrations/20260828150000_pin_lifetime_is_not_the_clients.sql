-- Hard rule 3, closed at the grant.
--
-- A pin's 72-hour ceiling is a CHECK anchored to `created_at`:
--   check (expires_at <= created_at + interval '72 hours')
-- and `created_at` was a column `authenticated` could INSERT. Supabase's
-- default privileges grant INSERT on every column of every table in `public`,
-- and 20260816210000 revoked only `update, truncate, references, trigger` —
-- so a request carrying `created_at` a month out satisfied the CHECK with an
-- `expires_at` a month out, and the pin sat on everyone's map, in city_pins,
-- in public_city_pins and in the heat layer for as long as it liked. The same
-- column is what `throttle_pins` counts, so a forged one also walks past the
-- rate limit.
--
-- Nothing in the app does this: `createPin` (src/features/pins/api.ts) sends
-- ten named columns and `created_at` is not one of them. But the anon key
-- ships inside the app, so "the client does not do it" is not a control — the
-- grant is. Column-level INSERT is the whole fix, and it costs the app
-- nothing because the list below is exactly what it already sends.
--
-- `seeded`, `seed_note` and `id` are left out on purpose too: a curated pin is
-- seeded server-side, and the CHECK `seeded = (user_id is null)` is only worth
-- anything if a client cannot set the flag.

revoke insert on public.pins from authenticated;

grant insert (
  user_id,
  city_id,
  venue_name,
  note,
  place_label,
  category,
  lat,
  lng,
  intent_date,
  expires_at
) on public.pins to authenticated;

comment on table public.pins is
  'Traveler pins. INSERT is granted per column: created_at is the anchor of '
  'the 72h CHECK and of the rate limit, so it belongs to the server.';

notify pgrst, 'reload schema';
