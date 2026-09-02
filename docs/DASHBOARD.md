# Liquidity dashboard — brief §6 metrics

Every metric the brief says to instrument from day one, and exactly where it
lives. Two sources: **PostHog** (app behavior; needs
`EXPO_PUBLIC_POSTHOG_API_KEY` in `.env`) and **admin SQL views** (marketplace
truth straight from Postgres; run in the Supabase SQL editor — they are
service-role-only and invisible to clients). One of them, `liquidity_daily`,
is a table rather than a view: it is the only history in the schema, because
pins delete themselves and cannot be counted afterwards.

**Until the PostHog key exists as a repo secret and in the EAS environment
(docs/APP_STORE.md), every PostHog-derived number on this page reads zero** —
not "nobody uses the app", but "no key reached a build". The four SQL admin
views from `20260817150000_launch_hardening.sql` are unaffected: they read
Postgres truth, not events. The publish workflows fail their preflight while
the key is missing, so a bundle can no longer ship with analytics silently
dead.

| §6 metric                                | Source                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Liquidity per city** (live trip/pin)   | `select * from admin_liquidity;` — read `liquidity` and `liquidity_reachable` together     |
| Liquidity over time                      | `select * from liquidity_daily order by day desc;` — one row per city per night            |
| Map DAU vs matching DAU                  | PostHog: unique users on `map_viewed` / `travelers_viewed`, both `account_type='traveler'` |
| Request → accept rate                    | `select * from admin_request_funnel;` — SQL only, not a PostHog funnel (insight 3)         |
| % first messages blocked                 | `select * from admin_moderation_stats;` **plus** PostHog `draft_flagged` (see below)       |
| Pin creation rate / heatmap views        | PostHog `pin_created`, `heatmap_viewed`; `admin_pin_stats` (live)                          |
| D1/D7 retention **within trip window**   | PostHog retention, cohorted on `trip_created` (caveat below)                               |
| **Pipeline health** (not in §6, but ops) | `select * from admin_ops_health;`                                                          |

## Admin query set (SQL editor)

```sql
select * from admin_liquidity;        -- THE number: distinct users w/ live trip or pin, per city
select * from liquidity_daily         -- the same counts, one row per city per night
  where day > current_date - 30 order by day desc, city_id;
select * from admin_request_funnel;   -- last 30d: delivered, accepted, accept %
select * from admin_moderation_stats; -- last 30d: attempts, blocked, % blocked (HALF the creep alarm)
select * from admin_pin_stats;        -- live pins + seeded share per city
select * from admin_report_queue;     -- open reports, URGENT FIRST then oldest (see below)
select * from admin_ops_health;       -- queue depths: are the workers alive?
select * from admin_verification_queue;          -- selfie verdicts, newest first: `reason` beside `reason_en` (what they were shown, and what it says)
select * from admin_business_verification_queue; -- the same for storefront verifications, with the business named
```

**The two verification queues are for an appeal, and they are the only
reader the selfie verdict's English has.** `reason_en` is required on both
moderation verdict schemas so that a refusal written in the subject's own
language stays adjudicable, but the selfie half was written into
`verification_requests.verdict` and read by nothing until 20260903040000
created these two views (modelled on `admin_report_queue`: service-role only,
`revoke all ... from anon, authenticated` on the line after each `create`, no
RPC, no client). Open the matching one when somebody appeals a refused selfie
or storefront through Contact us: `reason` is the sentence the person was
shown, `reason_en` is what it says, `engine` is which check decided, and
`attempts` is how many times it was tried. Nothing here re-runs a
verification; that stays a separate decision with consequences for
`profiles.verified`.

**`admin_report_queue` is ordered by urgency, not by age.** A report whose
reason is `underage` or `immediate_danger` sorts ahead of everything else,
however old the rest are, and then the remainder sorts oldest first. Those two
reasons also raise a push to whoever is named in
`app_config.support_notify_recipients`, titled `Report: under 18` or
`Report: somebody in danger` - so an urgent report reaches a phone rather than
waiting for somebody to open this page. Neither does anything else: decision
D34 keeps suppression a moderator action, so the reported account is untouched
until a person acts on it. Read the top of this queue first and take the
priority at face value; it is not a proxy for age.

**A report may name a chat and not a person.** Since group reporting landed,
`reports.reported_user_id` is nullable and `admin_report_queue` carries
`reported_chat_id` and `reported_chat_name` beside the person columns. A row
with a chat and no person is a report about the ROOM: somebody says the group
itself has gone bad. `admin_resolve_report(id, 'suspend')` on one of those
raises `this report names a chat and not a person: act on somebody in it, or
dismiss` - it is not a bug, it is the queue refusing to guess who you meant.
Open the room, decide who is doing it, act on that person by their user id, or
dismiss the report if the room is fine.

**`admin_liquidity` has two numbers now, and the pair is the point.**
`liquidity` is what it always was: distinct users in that city with a live pin
or an active trip. `liquidity_reachable` is the subset who have opened the app
in the last seven days (`profiles.last_seen_on`, written once a day by
`touch_last_seen()`). A trip can be posted weeks ahead and run for weeks, so
somebody who installed once, posted a trip and never came back counts toward
`liquidity` for that whole window - which means the 500-1,000 gate on opening a
second city can be met entirely by people who will never answer a first
message. Read them side by side: liquidity 800 with reachable 90 is a
different city from liquidity 800 with reachable 700, and only the second one
is ready.

Two cautions on the reachable column. It reads LOW for the first week after
the deploy, because `last_seen_on` is null for everybody until they next open
the app, and null counts as unreachable. And it is a date and never a time on
purpose: a per-minute last-seen is a presence signal, and this app's strongest
safety claim is that it never collects one (hard rule 2). Nothing surfaces the
column to another user and no client can read it at all.

**`liquidity_daily` is the history the live view cannot keep.** Pins hard-
expire within 72 hours and are deleted within 15 minutes of expiry (rule 3),
so a trend cannot be reconstructed after the fact - it is recorded as it
happens or it does not exist. A pg_cron job (`snapshot-liquidity`, 03:50 UTC,
after the message-request sweep at 03:40) writes one row per launch city with
the same counts the view shows. COUNTS ONLY and never rows: the table holds no
pin, no trip, no person and no coordinate, so rule 3 is untouched. Re-running
the job on the same day corrects that day rather than failing, so a manual
catch-up after a missed night is safe. Both it and the view are service-role
only.

**`admin_ops_health` is the daily smoke test.** `oldest_held_message_minutes`
or `oldest_unsent_push_minutes` climbing past ~10 means a worker schedule is
broken — messages are failing closed (nothing unscreened is delivered) but
users are waiting. `expired_pins_awaiting_sweep` staying above zero means
pg_cron isn't running the 72h purge.

All nine of the moderation worker's queues have a depth column
(20260903070000 added the four photo ones, 20260903140000 the last two).
`pending_photos` is PROFILE photos and `pending_verifications` is SELFIE
verifications; the rest name their queue. Two of them deserve a second look
every time: **`pending_storefronts` and `pending_scans` are the only queues
that can be switched OFF**, because each worker branch is skipped entirely
when its key is missing from the `MODERATION_PROMPTS_BUSINESS` secret. Either
one climbing while the others drain means that secret, not the schedule — the
worker will keep posting 200s throughout. Before 20260903140000 they had no
column at all, so a paused queue read here as all zeros.

Reading them: liquidity target is **500–1,000 in-season per city before
opening a new one** (brief §6). A **collapsing accept rate** or a **rising
creep number** is the early warning — check `admin_report_queue` and tighten
moderation before growing supply.

**`admin_moderation_stats.blocked_pct` is not that number on its own. It is a
lagging, deliberately suppressed one.** The composer warns about a risky draft
before anybody presses send, and the whole purpose of that warning is to turn
a would-be block into a rewrite — which removes the event from this
numerator. So blocked_pct falls over time for a reason that has nothing to do
with how many people are trying to send creepy first messages, and read alone
it shows a safety improvement that is a measurement artefact. The same
mechanism shifts the surviving mix toward `blocked_llm`, because the preview
is prefilter-only while the send path adds the classifier, so the trend also
imitates a classifier regression.

The creep signal is therefore:

```
(prefilter_blocked + llm_blocked + draft_flagged) / (attempts + draft_flagged)
```

`prefilter_blocked` and `llm_blocked` are `admin_moderation_stats`'
`blocked_prefilter` and `blocked_llm`; `attempts` is its `attempts`;
`draft_flagged` is the PostHog event, counted over the same 30 days.
`draft_flagged` is a PREFILTER signal only, so it must never be charted
like-for-like against `blocked_llm` — the two see different classifiers. Its
companion is `request_sent`'s `rewrote_after_warning`, which says how often a
warning ended in a message being sent anyway.

**Two send paths write no moderation_event at all**, so every block on them is
invisible to `admin_moderation_stats`: `message_business`
(20260828160000_businesses_not_places.sql:100) and `open_direct_chat`
(20260830000000_a_business_is_served_no_travelers.sql:306). Both screen the
text and both refuse silently as far as this view is concerned. `draft_flagged`
carries `surface = 'business'` for the composer in front of the first of them,
which is the only visibility that path has today. Documented rather than
fixed: adding audit rows to those two functions is its own change.

## PostHog insights to create (once the key exists)

1. **Map-led thesis** — trend of unique users: `map_viewed` vs
   `travelers_viewed`, daily, **both filtered `account_type = 'traveler'`**.
   Map should lead. **Map DAU is defined as** unique users on `map_viewed`
   with `account_type = 'traveler'`; **matching DAU** the same way on
   `travelers_viewed`.

   **`guest = false` is no longer the filter, and the swap is the whole
   point of this insight.** A business account can reach the Map tab
   (`components/app-tabs.tsx` renders the map trigger unconditionally) and is
   structurally barred from Travelers (`hidden={isBusiness}`), so filtering
   only guests out left every listed hostel and bar counting toward the map
   side of the ratio and toward nothing on the other. As listings grow that
   drifts in the direction the founder wants to see, for a reason that has
   nothing to do with travelers, and a flattering failure is the dangerous
   kind. `account_type` splits them. The guest funnel still reads off the
   same pair using `account_type = 'guest'` (a signed-out device says
   `signed_out`), and `is_guest` is kept as a boolean for the old charts.

   **`account_type = 'unknown'` is a real bucket and it is not noise.** The
   business query settles a beat after the first paint — the same race
   `components/app-tabs.tsx` documents for the tab list — so events fired in
   that window say `unknown` rather than guessing `traveler`. Exclude it from
   both sides of the ratio; if it ever grows past a few percent of
   `map_viewed`, the fix is to hold the first `map_viewed` until
   `businessSettled` the way `src/app/_layout.tsx` holds routing. An account
   part way through listing a business counts as `business`, matching what
   `useMapPins` already does with the same fact.

2. **Pin funnel** — the composer, step by step, not one conversion. Pins are
   the supply side of everything (no pins, no map, no heatmap, no reason to
   open the app), and `map_viewed → pin_created` said the number was low and
   nothing about why. The funnel is:

   `map_viewed` → `pin_compose_started` → `pin_compose_step` (`spot_named`) →
   `pin_compose_step` (`plan_written`) → `pin_compose_step` (`submitted`) →
   `pin_created`

   Each drop names a different lever:

   - **map_viewed → pin_compose_started** — nobody is opening the composer.
     A discovery problem: the map FAB, the empty state, the venue sheet.
     Break down by `entry` to see which of the three is carrying it.
   - **started → spot_named** — the composer opens with no name for the
     spot. That is place search or the reverse geocode failing, not a copy
     problem. This step counts a pre-filled name, so its absence is the
     signal.
   - **spot_named → plan_written** — people arrive at the one field the
     submit button waits for and do not fill it. A composer-length or
     motivation problem: read it next to `pin_compose_abandoned`'s
     `last_step`, which says where they stopped.
   - **plan_written → submitted** — the form was filled and the button never
     pressed. Look at what sits between them on screen.
   - **submitted → pin_created** — posts that failed. `pin_post_failed`
     carries `reason` (a Postgres/PostgREST code, or `network`), `city_id`
     and `joinable`; a spike in one `reason` in one city is a geofence or a
     migration, not disinterest.

   `heatmap_viewed` per session sits beside it. Renamed from
   `heatmap_rendered` on 2026-08-31 with a real semantic change: the old
   event fired when heat DATA arrived, the new one requires drawn pixels on
   an uncovered map (non-empty layer, no sheet over it, not place mode), once
   per city per session — so the series legitimately drops at the rename.

3. **Request funnel — and it is NOT a PostHog funnel.** `request_sent` is
   fired by the SENDER and `request_responded` by the RECIPIENT, which are
   two different distinct_ids, so no PostHog funnel can ever join them
   whatever the properties say. This page used to imply otherwise. The accept
   rate comes from SQL:

   ```sql
   select * from admin_request_funnel;   -- by city and by source
   ```

   The view splits the denominator four ways — accepted, declined, still
   pending, expired unanswered — instead of folding them into one, because
   the same falling rate is produced by a push outage, by slow responses and
   by people never seeing the hello, and those have different fixes. It also
   carries median hours to respond, groups by `city_id` and `source`
   (`trip_match` vs `pin`, which is the map-led thesis question), and buckets
   rows with no city as `unknown` rather than dropping them.
   `blocked_by_moderation` stays out of every denominator.

   The two events remain, for breakdowns only. `request_responded` carries
   `source` and `city_id` when the responding screen knows them; both read
   null until `incoming_requests()` returns them (see "Not wired yet" below).

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
   event). The database has exactly one last-seen fact, and it is not a
   fallback for this metric: `profiles.last_seen_on` (20260902210000), a
   DATE, written by `touch_last_seen()` at most once per calendar day when
   the app opens, service-role only, never a time. It is what
   `admin_liquidity.liquidity_reachable` reads (above). What it CAN answer:
   whether an account opened the app in the last N days. What it CANNOT
   answer: in-trip-window retention, or any D1/D7 — it is one date per
   person, overwritten daily, so there is no visit history to join against
   a trip's date range, and `liquidity_daily` holds counts, never people.
   Building that answer means a per-day activity history plus an
   `admin_trip_window_retention` view — new personal data collection on an
   app whose pitch is what it does not store, a line in the privacy policy,
   and a table one join away from a per-user movement record. That is a
   founder decision, not a footnote; until it is made, the filtered PostHog
   insight above is the only implementation this metric has.
5. **Safety pulse** — `user_blocked`, `user_reported`, `request_sent` with
   `delivered=false` over time.

**Break every insight above down by `update_id` before believing a move in
it.** This project ships JavaScript over the air most days, and PostHog's own
`$app_version` comes from the NATIVE binary — so a fortnight of updates all
report the same version and no metric change is attributable to the release
that caused it. `update_id` is the eight characters `BuildStamp` prints at
the bottom of the profile screen, read from `expo-updates` at launch, so the
id on a founder's screen and the id on the chart are the same object
(`release` in `src/lib/analytics.ts`). `is_embedded = true` means the phone
was running the binary's built-in bundle, which every install does for
exactly one launch — an update is never applied on the launch that downloads
it — so a chart that suddenly fills with embedded launches is a fetch
failing, not a rollback.

## Properties on every event

This is the REVIEWED list. Every property below was checked against one rule:
city, account kind and release are the point, and identity is not. A display
name, an email, a social handle, a message body, a business name and a raw
user id may never be an event property, on any event, ever —
`docs/PROGRESS.md` records a shipped bug where a real traveler's display name
reached analytics from a signed-out screen. **Check any new property against
this list before adding it**, and add it here in the same change.

Carried automatically by `analytics.capture`, so no call site states them:

| Property       | Values                                                       |
| -------------- | ------------------------------------------------------------ |
| `update_id`    | eight characters, or null on an embedded launch              |
| `is_embedded`  | boolean                                                      |
| `account_type` | `signed_out` / `guest` / `traveler` / `business` / `unknown` |
| `is_guest`     | boolean (true for `guest` and `signed_out`)                  |
| `city_id`      | integer, the city chip the map is on                         |

Stated by individual events: `guest`, `source`, `surface`, `category`,
`step`, `step_index`, `last_step`, `entry`, `reason`, `joinable`,
`intent_date`, `delivered`, `queued`, `blocked`, `accepted`,
`rewrote_after_warning`, `kind`, `state`, `answer`, `first_time`,
`step_name`, `position`, `cells`, `business_id`, `chat_id`.

The last two are the only remaining join keys into our own database, and they
are on notice. `chat_id` (on `message_sent`) buys the second-message rate in
insight 3 and has no substitute yet; `business_id` (on
`business_page_viewed`, `business_link_tapped`) names a public listing rather
than a person. `room_joined` and `room_left` used to carry `chat_id` and no
longer do: a room belongs to one business, so those two events plus the
database said which venue somebody was in and when, and nothing on this page
counted rooms per room.

**The distinct_id is PostHog's own per-install id, and nothing identifies
against the Supabase uid.** Handing PostHog the raw auth uid made the
distinct_id a join key into our database: anyone holding an export and the
database could reconstruct who talked to whom and when, inside a third-party
processor, for a product whose positioning is that it does not collect that,
with users disproportionately in the EU. The settled answer is a salted hash,
and **the salt has to be a server-side secret** — nothing in the app bundle
is secret, an `EXPO_PUBLIC_` salt ships inside the app, and a hash whose salt
the attacker holds is the same join key with extra steps. So until the server
mints that id there is no user-level identity at all, which costs exactly one
thing: looking a person's session up from a support ticket. Cross-device
stitching is gone too, which for a phone-only app is close to free.
`analytics.identify()` still exists, guarded so an unchanged id sends
nothing, and is what the server-minted id gets handed to.

**Opting out.** `analytics.setOptedOut(true)` calls the SDK's own opt-out,
which is persisted, so it survives a relaunch; `analytics.reset()` re-states
it, because PostHog's reset clears the flag and a sign-out would otherwise
turn somebody back on silently. Policy 5.1.1(i) asks how consent is
withdrawn, and this is the mechanism the answer names.

Event inventory — every event below is a real `analytics.capture` call in
`src/` and every capture call in `src/` is listed here; keep the two in step
with `grep -rhoE "analytics[.]capture[(]'[a-z_]+'" src` before adding a chart.
(All wired; no-op only in a dev build without the key — the publish
workflows refuse to ship a bundle without it.)

- **Map and pins**: `map_viewed`, `heatmap_viewed` (was `heatmap_rendered`;
  views need drawn pixels on an uncovered map, so the count is honest and
  lower), `pin_created`, `pin_tapped`, `pin_joined`, `pin_compose_step`
  (`step` is one of `spot_named`, `plan_written`, `submitted` — three stable
  names, and no step fires per keystroke), `pin_compose_abandoned`
  (`last_step`, the FURTHEST step in that order rather than the most recent,
  because the composer is a scroller and somebody can write the plan before
  naming the spot), `pin_post_failed` (`reason`, `city_id`, `joinable` — the
  reason is a Postgres/PostgREST code or one of `network`/`error`/`unknown`,
  never the error message, which quotes what somebody typed)
- **Matching and chat**: `travelers_viewed`, `request_sent` (carries
  `rewrote_after_warning`), `draft_flagged` (properties `category` and
  `surface`, never the draft and never the matched pattern),
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

**Not wired yet**, and listed separately for exactly that reason:

- `pin_compose_started` (`entry` = `map_fab` / `empty_state` / `venue_sheet`)
  is the first step of insight 2's funnel. It has to be fired where the
  composer is OPENED (`src/features/pins/map-screen.tsx`) rather than inside
  the sheet, because that is the only place that knows which of the three
  entry points was used. Until it exists, read the funnel from `map_viewed`
  straight to `pin_compose_step` (`spot_named`) and accept that the
  discovery drop and the place-search drop are folded together.
- `request_responded` carries only `accepted`, on purpose. It briefly took
  `source` and `city_id` too, and nothing could pass them: `incoming_requests()`
  returns neither column, so every event read null and the breakdown was one
  "no value" bucket. Widening that function means a drop-and-recreate on a
  live one, to feed an event that cannot use the answer anyway - `request_sent`
  is fired by the SENDER and `request_responded` by the RECIPIENT, two
  different distinct_ids, so no PostHog funnel can join them whatever the
  properties say. The split lives in `admin_request_funnel`, in SQL, where
  both sides of the hello are visible at once.
- `account_type` is `business` only once `useOwnBusiness` has answered. It is
  set from the auth listener, which is mounted once at the root, so it
  applies app-wide with no per-screen wiring.

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
