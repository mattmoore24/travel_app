# Go-live runbook

The single ordered checklist for taking a launch city live. Every other doc is
a detail page for one of these steps.

## 0. Backend is provisioned (done 2026-08-17)

The Supabase project exists, all migrations are applied, and `push-worker` +
`moderation-worker` are deployed. Deploys run from GitHub Actions — commit any
change to `supabase/.deploy-request` (or Actions → **Supabase deploy** → Run
workflow once the file is on `main`). Setup details: [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

## 1. Turn the safety pipeline on — ✅ DONE 2026-08-18

Default config ships **dark**: photos auto-approve and only the regex filter
screens messages. Do not let a build reach testers or App Review this way —
the review notes claim LLM screening, and it must be true.

**Status: on and exercised.** Both `app_config` flags are `true`, both cron
workers post 200s every minute, and `admin_ops_health` reads all zeros. Steps
a–c below are the record of how it was done; they do not need repeating unless
the project is rebuilt.

**Exercised 2026-08-19** by the live-backend canary (Actions → **Live backend
tests**, also scheduled weekly): against the production project, a clean first
message was held and then released by a real Claude verdict in ~21 seconds, and
a flirty first message was still undelivered after a 4-minute watch — 17/17
checks passed, including handle gating pre/post-accept, guest RLS, and full
delete-account teardown. Re-run it any time from the Actions tab.

> **Email confirmation is OFF for v1** (Auth → Sign In / Providers → Email →
> "Confirm email" toggle). With it on, `signUp` returns no session and the app
> has no confirmation deep-link flow, so every real signup silently dead-ends —
> the canary caught this. Before public launch, either keep it off knowingly or
> build the deep-linked confirmation flow first, then re-enable.

**a. Keys** — add `ANTHROPIC_API_KEY` **and `MODERATION_PROMPTS`** to GitHub
repo secrets and touch `supabase/.deploy-request`; the deploy workflow syncs
both to Edge Function secrets. `MODERATION_PROMPTS` is the JSON of classifier
system prompts (`supabase/functions/moderation-worker/prompts.example.json`
documents the shape) — it lives only in the secret because the repo is public
and the exact BLOCK/ALLOW rules would double as an evasion manual. Without it
the worker fails closed: nothing auto-approves, queues hold, and
`admin_ops_health.oldest_held_message_minutes` climbs. Editing the secret and
re-running the deploy workflow retunes moderation with no code change.

**b. Wake the workers** — the pg_cron jobs already exist from
`20260817230000_schedule_workers.sql`, but they no-op until Vault has the two
values they read. In the SQL editor, once:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<service_role_key>',        'service_role_key');
```

Confirm before going further — `select jobname, active from cron.job;` lists
both workers, and `select status_code, error_msg from net._http_response order by created desc limit 5;`
shows 200s. A 401 means the key was pasted wrong (`vault.update_secret` to fix).

**c. Only then, flip the flags:**

```sql
update app_config set value = 'true' where key = 'require_llm_moderation';
update app_config set value = 'true' where key = 'require_photo_moderation';
```

Order matters: with a flag on and no worker reaching the function, every first
message and photo waits in the held state — fail-closed, but broken UX.

Verify: send a flirty first message from a test account → it must never
arrive, and `select * from admin_moderation_stats;` must count it as blocked.

## 2. Verify a sending domain in Resend

**Step 2b below supersedes the state of this section.** `samewhere.io` was
registered on 2026-08-30 and mail now goes out from `hello@samewhere.io`
through Resend with Google receiving. What is left is a founder check, not a
setup: confirm the `SUPPORT_FROM` repo secret is set and the functions have
been redeployed since, then take the delivery proof at the foot of 2b. The
rest of this section is kept because it is the procedure, and because it
explains the failure mode if any of it is ever undone.

Before the domain existed, the only inbox in the world that could receive a
Samewhere email was the one the Resend account was opened with.

`support-mailer` sends from `SUPPORT_FROM`, which is unset, so it falls back to
Resend's shared `onboarding@resend.dev`. That address is a sandbox: with no
verified domain of your own, Resend accepts the send, returns a 200, and then
delivers only to the account owner's address. Everything else is dropped at
their end. That is why `mattmoore@wustl.edu` never got a business confirmation
code while `mattmoorefb24@gmail.com` did — the app was working, the mail was
not leaving Resend.

What that costs live: **no business but yours can confirm a listing**, and no
support reply, no message-request digest, and nothing else the mailer is ever
used for reaches a real user.

To fix, closer to go-live:

1. Resend → Domains → add the domain, publish the three DNS records it gives
   you (SPF, DKIM, and the return-path CNAME), wait for all three to go green.
2. Set the GitHub secret `SUPPORT_FROM` to an address on that domain, e.g.
   `Samewhere <hello@samewhere.app>`, and redeploy the functions (Actions →
   **Supabase deploy**).
3. Prove it: sign up a business on an address that is **not** the Resend
   account's own, and confirm the code arrives. Then
   `select * from outbound_mail order by created_at desc limit 5;` — every row
   should carry a `sent_at` and a null `delivery_error`.

The app already tells the truth in the meantime: `my_business_code_status()`
reads `outbound_mail`, and the code screen says the address bounced instead of
leaving somebody staring at "Check your email". That is a decent failure, not a
fix.

## 3. Confirm the scheduled jobs

| Job                          | Runs on                    | Check                                                     |
| ---------------------------- | -------------------------- | --------------------------------------------------------- |
| `moderation-worker`          | Dashboard schedule (1/min) | `admin_ops_health.oldest_held_message_minutes` stays < 10 |
| `push-worker`                | Dashboard schedule (1/min) | `admin_ops_health.oldest_unsent_push_minutes` stays < 10  |
| `expire_pins()`              | pg_cron, every 15 min      | `admin_ops_health.expired_pins_awaiting_sweep` near 0     |
| `lift_expired_suspensions()` | pg_cron, every 15 min      | suspended users reactivate on time                        |

`select * from admin_ops_health;` is the one-query health check. pg_cron jobs:
`select * from cron.job;` (the migrations schedule them automatically where
the extension exists).

## 4. Open the city and seed it

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

## 5. Repo goes private again before real users arrive

The repo is **public while building** (free unlimited CI minutes — the macOS
E2E runner alone bills 10x on private repos). That trade is only safe
pre-launch. Before opening the app to real users, in this order:

- **Flip the repo private**: GitHub → Settings → General → Danger Zone →
  Change visibility. Everything public until that moment stays public forever
  (clones, archive crawlers), which is fine for code and docs — it is NOT fine
  for what comes next, which is why this happens before launch, not after.
- **Stop the `e2e-results` screenshot branch first**: post-launch E2E runs
  screenshot the app against the production backend — real names, photos and
  pins force-pushed to a git branch. Private repo makes that branch private
  again; delete the historical branch too (`git push origin :e2e-results`).
- **Purge the demo travelers**: Actions -> **Demo travelers** -> Run workflow ->
  `purge`, then run it again with `check` — the check is the gate, and it stays
  red while any demo account can still sign in, so a half-taken purge cannot
  pass on trust. The seeded accounts exist so the Travelers tab, matching and
  first messages can be tested on a real device. They are AI-generated, not
  real people, and every bio carries a `[demo]` marker (shown in the app as a
  "Sample profile" chip), but no real user should ever see them.
- **Re-check Actions billing**: private CI bills minutes again. Set a spending
  limit (Settings → Billing) that covers ~$1.10 per full E2E run and pennies
  per deploy/TestFlight orchestration, or lean on the 2,000 free monthly
  minutes and expect the occasional cap.
- Optional hardening: rotate the `MODERATION_PROMPTS` wording — the prompts
  were never in the public repo, so this is belt-and-suspenders only.

## 6. Ship the build

[`APP_STORE.md`](APP_STORE.md) has the full sequence: EAS environment
variables → `eas build` → TestFlight → App Review notes → privacy labels.
Needs the Apple Developer membership.

## 7. Watch the numbers

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

## 2b. The domain, and everything behind it

`samewhere.io` exists as of 2026-08-30, with `hello@samewhere.io`. That one
purchase unblocks seven things, and they need doing in this order.

**Resend only sends. It does not give you an inbox.** Verifying the domain lets
the app send _from_ `hello@samewhere.io`; it does not make that address receive
anything. `SUPPORT_INBOX` is where support mail and every business report lands,
so set up receiving first — Cloudflare Email Routing or ImprovMX forwards to an
existing inbox for free, and forwarding is fine for launch.

1. **Receiving.** Publish the forwarder's MX records. Send yourself a test.
2. **Sending.** Resend → Domains → add `samewhere.io`, publish the SPF, DKIM and
   return-path records, wait for all three green. Keep Resend's return path on a
   subdomain (`send.samewhere.io`) so it cannot collide with the forwarder's MX.
3. **DMARC**, recommended: `_dmarc.samewhere.io` TXT
   `v=DMARC1; p=none; rua=mailto:hello@samewhere.io`. Start at `p=none`.
4. **Secrets:** `SUPPORT_FROM` = `Samewhere <hello@samewhere.io>` and
   `RESEND_API_KEY`. `SUPPORT_INBOX` needs no secret any more — it is pinned to
   `hello@samewhere.io` in the deploy workflow itself, and an old
   `SUPPORT_INBOX` repo secret can be deleted. Then Actions →
   **Supabase deploy**.
5. **Analytics secrets**, unrelated to mail but on the same checklist because
   nothing measures anything until they exist: `EXPO_PUBLIC_POSTHOG_API_KEY` and
   `EXPO_PUBLIC_POSTHOG_HOST` as repo secrets, and the same pair in the EAS
   environment for builds. The update workflows pass them and their preflight
   now FAILS without the key, the same loud check the Supabase pair gets — a
   bundle published without it ships every capture() as a silent no-op, and the
   launch window cannot be measured after the fact. Create the PostHog project
   in the EU region; the privacy policy promises EU data residency.
6. **Hosting.** DONE: [`web/`](../web/README.md) is served at
   `link.samewhere.io` — the subdomain, not the apex, which stays on
   Squarespace with the Workspace mail records. The association file is live
   and verified: 200, `application/json`, zero redirects, real Team ID.

   Six paths are served, and every one of them is load-bearing for something
   that cannot be fixed after submission:

   | Path                                      | Who breaks without it                                                    |
   | ----------------------------------------- | ------------------------------------------------------------------------ |
   | `/.well-known/apple-app-site-association` | every universal link falls back to Safari, silently                      |
   | `/privacy`                                | App Store Connect's Privacy Policy URL field is mandatory                |
   | `/guidelines`                             | the DSA wants the rules and the appeal route public                      |
   | `/support`                                | App Store Connect's Support URL, and guideline 1.2's "published" contact |
   | `/i/<token>`                              | anybody who is sent an invite and does not have the app                  |
   | `/reset`                                  | anybody who opens a password reset on a laptop                           |

   After any deploy, run the whole-surface curl loop at the foot of
   [`web/README.md`](../web/README.md) — it checks all six plus a real 404,
   and the association file without `-L`, which is what proves zero redirects.

7. **Then the app:** DONE in code — `ios.associatedDomains:
["applinks:link.samewhere.io"]` in `app.json` AND the route
   `src/app/i/[token].tsx`, in one commit. The route is not optional: a
   declared path with no route opens the app on +not-found, which is worse
   than the Safari page it replaced. What remains is the EAS build, and
   before submitting it, the Apple CDN check in web/README.md §3. Leave
   `UNIVERSAL_LINKS_LIVE` **false** — the reset link already reaches the app
   through Supabase's own 302 to `samewhere://reset-password`, the allowlist
   holds both spellings, and the association file deliberately does not claim
   `/reset*`. See the header of `src/constants/links.ts` for the four things
   that have to be true before that flag can move.

Proof for step 2: sign up a business on an address that is **not** the Resend
account's own and confirm the code arrives, then
`select * from outbound_mail order by created_at desc limit 5;` — every row
should carry `sent_at` and a null `delivery_error`.
