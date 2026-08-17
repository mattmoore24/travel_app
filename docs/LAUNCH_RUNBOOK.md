# Go-live runbook

The single ordered checklist for taking a launch city live. Every other doc is
a detail page for one of these steps.

## 0. Backend is provisioned (done 2026-08-17)

The Supabase project exists, all migrations are applied, and `push-worker` +
`moderation-worker` are deployed. Deploys run from GitHub Actions — commit any
change to `supabase/.deploy-request` (or Actions → **Supabase deploy** → Run
workflow once the file is on `main`). Setup details: [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

## 1. Turn the safety pipeline on ⚠️ before any real user

Default config ships **dark**: photos auto-approve and only the regex filter
screens messages. Do not let a build reach testers or App Review this way —
the review notes claim LLM screening, and it must be true.

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # or add the GitHub secret and redeploy
```

Then, in the SQL editor:

```sql
update app_config set value = 'true' where key = 'require_llm_moderation';
update app_config set value = 'true' where key = 'require_photo_moderation';
```

**Schedule both workers** (Dashboard → Edge Functions → the function →
Schedules → every minute). Without a schedule, held messages never deliver
and photos stay pending — fail-closed, but broken UX.

Verify: send a flirty first message from a test account → it must never
arrive, and `select * from admin_moderation_stats;` must count it as blocked.

## 2. Confirm the scheduled jobs

| Job                          | Runs on                    | Check                                                     |
| ---------------------------- | -------------------------- | --------------------------------------------------------- |
| `moderation-worker`          | Dashboard schedule (1/min) | `admin_ops_health.oldest_held_message_minutes` stays < 10 |
| `push-worker`                | Dashboard schedule (1/min) | `admin_ops_health.oldest_unsent_push_minutes` stays < 10  |
| `expire_pins()`              | pg_cron, every 15 min      | `admin_ops_health.expired_pins_awaiting_sweep` near 0     |
| `lift_expired_suspensions()` | pg_cron, every 15 min      | suspended users reactivate on time                        |

`select * from admin_ops_health;` is the one-query health check. pg_cron jobs:
`select * from cron.job;` (the migrations schedule them automatically where
the extension exists).

## 3. Open the city and seed it

```sql
-- Only Lisbon at first: launch dense, not wide (brief §2.6).
update launch_cities set active = false;
update launch_cities set active = true
  where city_id = (select id from cities where name = 'Lisbon' and country_code = 'PT');
```

Seed curated pins so the map is never empty: run
[`supabase/seed/launch_pins.sql`](../supabase/seed/launch_pins.sql). **Pins
expire within 72h — re-run it every 2 days** during launch, or the map goes
cold. Check supply with `select * from admin_pin_stats;`.

## 4. Ship the build

[`APP_STORE.md`](APP_STORE.md) has the full sequence: EAS environment
variables → `eas build` → TestFlight → App Review notes → privacy labels.
Needs the Apple Developer membership.

## 5. Watch the numbers

Daily, from [`DASHBOARD.md`](DASHBOARD.md): `admin_liquidity` (the number that
matters), `admin_request_funnel` (accept rate — a collapse means creep),
`admin_moderation_stats` (blocked % — the early warning), and
`admin_report_queue` (act on reports with `admin_resolve_report`).

Target before opening city #2: **500–1,000 in-season users with a live trip
or pin** in city #1.

## Rollback levers (all instant, no app release)

| Situation                           | Lever                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Abuse spike in a city               | `update launch_cities set active = false where city_id = ...;` — hides its pins, blocks new ones                                                             |
| Moderation API outage               | Messages hold automatically (fail-closed). To keep delivering with regex only: `update app_config set value = 'false' where key = 'require_llm_moderation';` |
| Bad actor                           | `select admin_resolve_report(<id>, 'ban');` or `'shadowban'`                                                                                                 |
| Heat too revealing in a sparse city | `update launch_cities set heat_k = 5 where city_id = ...;`                                                                                                   |
| Bad migration                       | Fix forward: new migration + trigger a deploy (never edit an applied one)                                                                                    |
