# Liquidity dashboard — brief §6 metrics

Every metric the brief says to instrument from day one, and exactly where it
lives. Two sources: **PostHog** (app behavior; needs
`EXPO_PUBLIC_POSTHOG_API_KEY` in `.env`) and **admin SQL views** (marketplace
truth straight from Postgres; run in the Supabase SQL editor — they are
service-role-only and invisible to clients).

| §6 metric                                | Source                                                              |
| ---------------------------------------- | ------------------------------------------------------------------- |
| **Liquidity per city** (live trip/pin)   | `select * from admin_liquidity;`                                    |
| Map DAU vs matching DAU                  | PostHog: unique users on `map_viewed` vs `travelers_viewed`         |
| Request → accept rate                    | `select * from admin_request_funnel;` (+ `request_responded` event) |
| % first messages blocked                 | `select * from admin_moderation_stats;`                             |
| Pin creation rate / heatmap views        | PostHog `pin_created`, `heatmap_rendered`; `admin_pin_stats` (live) |
| D1/D7 retention **within trip window**   | PostHog retention, cohorted on `trip_created` (caveat below)        |
| **Pipeline health** (not in §6, but ops) | `select * from admin_ops_health;`                                   |

## Admin query set (SQL editor)

```sql
select * from admin_liquidity;        -- THE number: distinct users w/ live trip or pin, per city
select * from admin_request_funnel;   -- last 30d: delivered, accepted, accept %
select * from admin_moderation_stats; -- last 30d: attempts, blocked, % blocked (creep alarm)
select * from admin_pin_stats;        -- live pins + seeded share per city
select * from admin_report_queue;     -- open reports w/ strike context (Phase 5)
select * from admin_ops_health;       -- queue depths: are the workers alive?
```

**`admin_ops_health` is the daily smoke test.** `oldest_held_message_minutes`
or `oldest_unsent_push_minutes` climbing past ~10 means a worker schedule is
broken — messages are failing closed (nothing unscreened is delivered) but
users are waiting. `expired_pins_awaiting_sweep` staying above zero means
pg_cron isn't running the 72h purge.

Reading them: liquidity target is **500–1,000 in-season per city before
opening a new one** (brief §6). A **collapsing accept rate** or a **rising
blocked %** is the creep early-warning — check `admin_report_queue` and
tighten moderation before growing supply.

## PostHog insights to create (once the key exists)

1. **Map-led thesis** — trend of unique users: `map_viewed` vs
   `travelers_viewed`, daily. Map should lead.
2. **Pin funnel** — `map_viewed → pin_created` conversion, and
   `heatmap_rendered` per session.
3. **Request funnel** — `request_sent` (property `delivered` true/false) →
   `request_responded` (property `accepted`).
4. **Trip-window retention** — retention insight, cohort event `trip_created`,
   return event "any event", horizon 7 days. Calendar retention is
   intentionally NOT the metric — travelers churn between trips by design.
   **Two honest caveats**: (a) map-only users who never post a trip are
   invisible to this cohort — pair it with a second retention insight
   cohorted on `pin_created`; (b) PostHog cohorts on event date, not on the
   trip's actual date range, so a trip posted weeks ahead dilutes D1/D7. For
   a true in-window number, filter the insight to users whose
   `trip_created` had `starts_within_days` ≤ 2 (that property is on the
   event) or read it from the database instead.
5. **Safety pulse** — `user_blocked`, `user_reported`, `request_sent` with
   `delivered=false` over time.

Event inventory (all wired, no-op until the key exists): `map_viewed`,
`heatmap_rendered`, `pin_created`, `pin_tapped`, `travelers_viewed`,
`matches_viewed`, `trip_created`, `trip_cancelled`, `request_sent`,
`request_responded`, `message_sent`, `unmatched`, `user_blocked`,
`user_reported`.

## Launch-city operations

Open/close a city (SQL editor — takes effect immediately, no app release):

```sql
update launch_cities set active = true  where city_id = (select id from cities where name = 'Lisbon' and country_code = 'PT');
update launch_cities set active = false where city_id = ...;  -- closing hides its pins and blocks new ones
```

Add a new launch city: `insert into launch_cities (city_id, radius_km, heat_k) values ((select id from cities where name = '...' and country_code = '..'), 40, 3);`

Seed curated pins so no city launches empty: run
[`supabase/seed/launch_pins.sql`](../supabase/seed/launch_pins.sql) in the SQL
editor. Pins expire ≤72h, so re-run it (or vary it) every couple of days
during launch — it only inserts for ACTIVE cities and skips duplicates that
are still live.
