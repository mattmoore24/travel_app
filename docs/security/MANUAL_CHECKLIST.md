# Things only you can do

Everything in this file is a **vendor dashboard setting** that no migration, no
workflow and no line of this repository can set or assert. Each one is written
as: what to set, why, and where — with the navigation path spelled out. Where a
vendor's current UI wording is not something this audit could verify from
inside the app, that is said so rather than guessed at.

Project ref: `vwduwqwvzzqhvbpwqubx` (eu-central-1).
Repository: **public** — see §5, which matters more than it looks.

Tick the boxes as you go; this file is meant to be committed with them ticked.

---

## 1. Anthropic — a spend limit (do this one first)

- [ ] **Set a monthly spend limit on the Anthropic account.**

Everything in `COST_CONTROLS.md` is a control _we_ wrote, in code _we_ can get
wrong. This is the one that holds when ours does not, and it is the only
control in this document that cannot be defeated by a bug in the other ones.

**Where:** console.anthropic.com → **Settings** → **Limits** (spend limits live
alongside rate limits; on some plans this is under **Billing**). Set a monthly
cap and an email alert threshold below it.

**What to set it to:** above a month of the new ceiling and far below a
runaway. The daily cap is 2,000 calls at roughly $0.02–$0.07 each, so a month
is on the order of $1,200–$4,200 at a _fully saturated_ ceiling and a small
fraction of that in reality. A limit of a few hundred dollars a month with an
alert at half is honest for TestFlight; raise it with the call cap at launch.

---

## 1a. The one that is already public — do this next, IN THIS ORDER

Your personal Gmail is currently rendered, in full, in screenshots on the
public `e2e-results` branch — `results/19e-change-your-email.png` draws
"You sign in with &lt;your address&gt; today". The secret kept it out of the
source and the app photographed it instead; `::add-mask::` cannot mask a pixel.

**The order matters. Changing the secret first orphans 14 live accounts.**

- [ ] **STEP 1 — purge the demo accounts while the OLD secret still works.**

`scripts/seed-demo-travelers.mjs` derives every demo address from the current
secret (`${user}+sw-demo-${slug}@${domain}`), and so do `purge` and `check`.
Production holds **12** `…+sw-demo-…@gmail.com` accounts right now, plus one
`+sw-live-` and one `+sw-e2e-`.

Change the secret first and those addresses become uncomputable: `purge` looks
for accounts that were never created and reports them absent, and `check` —
which is _the launch gate, red while any demo account can still sign in_ — gets
an invalid-credentials error for each address, reads that as "deleted", and
**passes while all 12 are still signed-in-able with `DEMO_PASSWORD`**. A green
gate over 12 live accounts is worse than no gate.

So: **Actions → Demo travelers → `purge`**, then run it again with `check` and
see it green. Only then continue.

- [ ] **STEP 2 — set `TEST_EMAIL_BASE` to `e2e@samewhere.io`.**

**Not `hello@wagvive.com`.** It would work mechanically — nothing ever reads the
inbox (email confirmations are off on this project: 22 of 24 users were
confirmed instantly and one confirmation mail has ever been sent), the `+` tag
is just a string, and my new guard would let it publish. The problem is what it
_says_. The address is drawn into screenshots that go to a **public** branch for
ever, and `wagvive` appears nowhere in this repository — so publishing it
creates a permanent public link between samewhere and an unrelated business,
and puts that address in front of every scraper that reads GitHub.

`samewhere.io` costs you nothing to disclose: it is already in this repo, in the
App Store listing and in the privacy policy. Prefer `e2e@` over `hello@` so that
if confirmations are ever switched on, auth mail does not land in your live
support queue. The mailbox does not need to exist — nothing delivers to it.

**Where:** GitHub → **Settings** → **Secrets and variables** → **Actions** →
`TEST_EMAIL_BASE`.

Until you change it, `e2e.yml` refuses to publish screenshots to the public
branch and attaches them as a workflow artifact instead, with an error saying
why.

- [ ] **STEP 3 — replace what is already on the branch.** Re-run E2E; it
      force-pushes an orphan commit, so a fresh run replaces the whole tree.
      Or delete the `e2e-results` branch and let the next run recreate it.
      Neither undoes anything already cloned or indexed — treat the address as
      public and change it anywhere that matters.

---

## 1b. Eight test accounts are live on production

- [ ] **Delete the leftover E2E accounts.**

Teardown is best-effort and has not always run. These are live right now:

```sql
select id, email, created_at from auth.users
where email like '%sw-e2e%' or email like '%maestro%'
order by created_at desc;
```

Seven of them are `maestro-*@samewhere.test`, opened with the password that was
written out in `e2e.yml` in this public repository until today. That password is
generated per run now, so no _new_ account is exposed — but these eight predate
the change and anyone who read the workflow can sign into the seven.

They hold no data. An account is still an account: it can send, pin, report and
spend the moderation budget.

**Changing the password is necessary but not sufficient on its own.** All eight
carry a live session and an unrevoked refresh token, and a refresh token holder
keeps access without ever needing the password. Any rotation has to revoke
those too — which is what I did (see PROGRESS.md); this box stays here for the
part that is still yours.

What they own, checked live: the seven `maestro-*` accounts own **nothing** —
no completed profile, no business, no pin, no trip, no message, no photo. The
`…+sw-e2e-…@gmail.com` one has a completed profile and one active trip, so it
is a fake traveler that real users can see in the app.

If you would rather they were gone than merely inert, that is now a dashboard
job — `e2e/account.mjs teardown-extras` signs in with a password it is given,
so it can only remove accounts from its own run:

**Authentication** → **Users**, filter on `maestro`, delete. The FK graph
cascades the rest. The `sw-e2e` one is the only one holding any data.

---

## 2. Supabase — the database and API

- [ ] **Exposed schemas = `public` only.** ← **this is the whole of SEC-002**

Not a belt-and-braces check: it is the ONLY thing protecting `pg_net`. I wrote a
migration to revoke those grants and then measured it on the live database
inside a rolled-back transaction - it changes nothing. `net` and all twelve of
its functions belong to `supabase_admin`; migrations run as `postgres`, which is
not a superuser and not the owner, so the revoke is a silent no-op. Nothing in
this repository can close that door. `pg_net`
puts `net.http_post` and friends in schema `net` and grants them to `PUBLIC`;
`20260906090000` revokes `anon` and `authenticated` from all of it, but the
reason it was never exploitable is that schema `net` is not exposed through
PostgREST. That is this setting, and this repository cannot see it.

**Where:** Dashboard → **Project Settings** → **Data API** → **Exposed
schemas**. It should list `public` (and `graphql_public` if present). If `net`,
`storage`, `vault`, `extensions` or `auth` appear there, remove them.

- [ ] **Leaked password protection ON.** (SEC-004)

Checks new passwords against HaveIBeenPwned. Currently **disabled** — read from
the live advisor, not guessed.

**Where:** Dashboard → **Authentication** → **Attack Protection** (older
consoles: **Authentication** → **Policies** / **Providers** → the Email
provider's password settings). Search the Authentication section for "leaked"
if the heading has moved.

- [ ] **Anonymous sign-ins OFF.** (SEC-008)

The app has a deliberate guest mode built on real accounts and RLS; it does
**not** use Supabase's anonymous-sign-in auth feature. Anything that feature
allows is therefore pure attack surface, and an account that costs nothing to
create is the input to every per-account cap in `COST_CONTROLS.md`.

**Where:** Dashboard → **Authentication** → **Sign In / Providers** → _Allow
anonymous sign-ins_.

- [ ] **Auth rate limits reviewed.**

Signup, OTP and email-send rates are the throttle on account creation, and
account creation is what converts a per-account cap into an N-account cap.

**Where:** Dashboard → **Authentication** → **Rate Limits**.

- [ ] **Project spend cap ON.**

**Where:** Dashboard → **Organization** → **Billing** → _Spend cap_. With it
on, the project is throttled rather than billed past the plan. This is the
Supabase-side equivalent of §1 and it covers the egress and row-read spend that
`COST_CONTROLS.md` §3 deliberately leaves unbounded in code.

- [ ] **Storage upload file size limit.**

`20260906110000` sets 5 MB and `image/jpeg` per bucket, which is the tighter of
the two. Set the project ceiling at or below a sane number as well, so a bucket
added later without limits inherits something.

**Where:** Dashboard → **Project Settings** → **Storage** → _Upload file size
limit_.

---

## 3. Before launch, not now

- [ ] **Raise `moderation_daily_call_cap`.**

```sql
update public.app_config set value = '20000'
where key = 'moderation_daily_call_cap';
```

2,000/day is sized for TestFlight. Left there on launch day it will hold real
users' first hellos, and the symptom is silent: held messages, nothing in the
logs that reads as an error. Check it with:

```sql
select * from public.worker_status();
-- 'moderation spend today' reports  <claimed> / <cap> claimed  [— PAUSED]
```

- [ ] **Confirm the two moderation flags are ON in production.**

```sql
select key, value from public.app_config
where key in ('require_llm_moderation', 'require_photo_moderation');
```

Both must be `true` in production — hard rule 5. They ship `false` so a keyless
dev machine and CI still work, which means "off" and "not yet configured" look
identical, which is exactly why this is a checklist item.

---

## 3b. At the next Expo SDK bump

- [ ] **Re-check the dependency audit on a machine with network.**

`npm audit` reports 5 high, all transitive, all in the Metro build toolchain
(`metro`, `metro-config`, `metro-transform-worker`, `@expo/metro`,
`image-size`). None of them ships inside the app binary.

I deliberately did **not** run `npm audit fix`: Expo SDK 57 pins Metro, and
moving off those pins is the documented way to break a build. The Expo-blessed
check could not run from the audit sandbox at all — the proxy denies
`cdp.expo.dev` — so I could not verify what the fix would produce.

```bash
npx expo install --check   # let Expo decide the versions
npm audit                  # then see what is genuinely left
```

---

## 4. Apple

- [ ] **Rotate nothing yet — but know what exists.** No secret has ever been
      committed to this repository (SEC-001: 204 commits, 7 branches, 15
      patterns, all clean), so there is no exposure-driven rotation to do. The
      keys in `INVENTORY.md` are listed so that _if_ one is ever exposed you
      have the list without having to rediscover it.
- [ ] **App Store Connect API key**: confirm it is a _team_ key with the
      minimum role that lets the TestFlight workflow upload, not an Account
      Holder key.

---

## 5. GitHub — the repository is public

Public repository means **every Actions log is world-readable, for ever**, and
a value printed once cannot be unprinted. The workflows redact
(`.github/scripts/` has a log redactor with its own tests) but the setting
below is the backstop.

- [ ] **Secret scanning ON.** Settings → **Code security and analysis** →
      _Secret scanning_.
- [ ] **Push protection ON.** Same page. This is the one that refuses a commit
      containing a key _before_ it reaches a public history, which is the only
      time refusing is cheap.
- [ ] **Confirm no fork or branch protection gap** lets a pull request from a
      fork read repository secrets.
- [ ] **Put `supabase-deploy` behind an Environment with a required reviewer.**
      (SEC-017) That workflow triggers on a push touching
      `supabase/.deploy-request` on **any branch** and runs `supabase db push`
      against the live database with that branch's migrations. It is the deploy
      flow this project uses on purpose, so I have not narrowed it — but there
      is no approval step between a branch push and production DDL.
      **Where:** Settings → **Environments** → New environment `production` →
      _Required reviewers_ → you. Then add `environment: production` to the
      deploy job. Say the word and I will make that one-line change.

---

## 6. Already verified — nothing to do, recorded so nobody re-checks

Read live during this audit, listed so this file is the whole picture:

| Setting                                     | State                               |
| ------------------------------------------- | ----------------------------------- |
| Edge Function JWT verification              | `verify_jwt: true` on **all seven** |
| Storage buckets public?                     | `public = false` on **all five**    |
| RLS on every `public` table                 | enabled, no exceptions              |
| `SECURITY DEFINER` with mutable search_path | **0** of 205                        |
| Secrets in git history                      | none, ever                          |
