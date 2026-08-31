# Liquidity dashboard — brief §6 metrics

Every metric the brief says to instrument from day one, and exactly where it
lives. Two sources: **PostHog** (app behavior; needs
`EXPO_PUBLIC_POSTHOG_API_KEY` in `.env`) and **admin SQL views** (marketplace
truth straight from Postgres; run in the Supabase SQL editor — they are
service-role-only and invisible to clients).

**Until the PostHog key exists as a repo secret and in the EAS environment
(docs/APP_STORE.md), every PostHog-derived number on this page reads zero** —
not "nobody uses the app", but "no key reached a build". The four SQL admin
views from `20260817150000_launch_hardening.sql` are unaffected: they read
Postgres truth, not events. The publish workflows fail their preflight while
the key is missing, so a bundle can no longer ship with analytics silently
dead.

| §6 metric                                | Source                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Liquidity per city** (live trip/pin)   | `select * from admin_liquidity;`                                                          |
| Map DAU vs matching DAU                  | PostHog: unique users on `map_viewed` / `travelers_viewed`, both filtered `guest = false` |
| Request → accept rate                    | `select * from admin_request_funnel;` (+ `request_responded` event)                       |
| % first messages blocked                 | `select * from admin_moderation_stats;`                                                   |
| Pin creation rate / heatmap views        | PostHog `pin_created`, `heatmap_rendered`; `admin_pin_stats` (live)                       |
| D1/D7 retention **within trip window**   | PostHog retention, cohorted on `trip_created` (caveat below)                              |
| **Pipeline health** (not in §6, but ops) | `select * from admin_ops_health;`                                                         |

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
   `travelers_viewed`, daily, **both filtered `guest = false`**. Map should
   lead. **Map DAU is defined as** unique users on `map_viewed` with
   `guest = false`; **matching DAU** the same way on `travelers_viewed`. Both
   events fire for guests too (tagged `guest = true`) so the guest funnel can
   be read from the same pair — but a guest browsing is not a DAU, and the
   flag is what keeps the two sides of the ratio honest.
2. **Pin funnel** — `map_viewed → pin_created` conversion, and
   `heatmap_rendered` per session.
3. **Request funnel** — `request_sent` (property `delivered` true/false) →
   `request_responded` (property `accepted`).
   **Derived: second-message rate** — of conversations opened by an accepted
   hello or a joined pin, the share that reach a second **inbound**
   `message_sent` (a `message_sent` on the same `chat_id` from the person who
   did not open it; `surface` says `direct` vs `room`). Accept rate is only a
   proxy — this is the marketplace-health number it stands in for: did the
   conversation actually start?
4. **Trip-window retention** — retention insight, cohort event `trip_created`,
   return event "any event", horizon 7 days. Calendar retention is
   intentionally NOT the metric — travelers churn between trips by design.
   **Two honest caveats**: (a) map-only users who never post a trip are
   invisible to this cohort — pair it with a second retention insight
   cohorted on `pin_created`; (b) PostHog cohorts on event date, not on the
   trip's actual date range, so a trip posted weeks ahead dilutes D1/D7. For
   a true in-window number, filter the insight to users whose
   `trip_created` had `starts_within_days` ≤ 2 (that property is on the
   event). There is no database fallback: in-trip-window retention has **no
   server-side implementation today** — no migration defines a `last_seen`,
   `last_active` or `seen_at` column anywhere, so a visit is never recorded
   in Postgres and nothing can be joined against a trip's date range.
   Building one means a day-granularity `users.last_seen_on` column written
   on app open plus an `admin_trip_window_retention` view — which is new
   personal data collection on an app whose pitch is what it does not store,
   needs a line in the privacy policy, and sits one join away from a
   per-user activity history. That is a founder decision, not a footnote;
   until it is made, the filtered PostHog insight above is the only
   implementation this metric has.
5. **Safety pulse** — `user_blocked`, `user_reported`, `request_sent` with
   `delivered=false` over time.

Event inventory — every event below is a real `analytics.capture` call in
`src/` and every capture call in `src/` is listed here; keep the two in step
with `grep -rhoE "analytics[.]capture[(]'[a-z_]+'" src` before adding a chart.
(All wired; no-op only in a dev build without the key — the publish
workflows refuse to ship a bundle without it.)

- **Map and pins**: `map_viewed`, `heatmap_rendered`, `pin_created`,
  `pin_tapped`, `pin_joined`
- **Matching and chat**: `travelers_viewed`, `request_sent`,
  `request_responded`, `message_sent`, `direct_chat_opened`, `left_chat`
- **Trips**: `trip_created`, `trip_cancelled`, `trip_deleted`
- **Groups and rooms**: `group_created`, `group_joined`,
  `group_member_added`, `group_member_removed`, `room_joined`, `room_left`
- **Guest funnel**: `gate_shown`, `gate_tapped`, `gate_signin_tapped`,
  `guest_joined`, `intro_completed`
- **Signup and onboarding**: `signup_started`, `signup_step_completed`,
  `signup_apple_used`, `onboarding_completed`, `profile_photo_added`,
  `profile_prompt_saved`, `profile_priority_saved`
- **Notifications**: `push_primer_shown`, `push_primer_answered`,
  `push_permission_state`, `push_opened`
- **Safety and support**: `user_blocked`, `user_reported`,
  `support_message_sent`
- **Business**: `business_registered`, `business_step_completed`,
  `business_email_confirmed`, `business_storefront_submitted`,
  `business_post_created`, `my_business_viewed`

`matches_viewed` and `unmatched` used to be listed here and exist nowhere in
`src/` — each would have produced a permanently empty chart, and an empty
chart reads as "nobody uses matching" rather than "this event was never
written". Neither name may return: the vocabulary they came from is banned.

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
