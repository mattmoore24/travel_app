# Supabase setup — founder walkthrough

One-time, ~15 minutes. After this, every phase built so far goes live end-to-end.

## 1. Create the project (~3 min)

1. Go to [supabase.com](https://supabase.com) → **Start your project** → sign in with GitHub.
2. **New project**:
   - **Name**: `travel-app`
   - **Database password**: generate a strong one and **save it in your password manager** —
     you'll need it once for pushing migrations, and it is not shown again.
   - **Region**: `West EU (Ireland)` or `Central EU (Frankfurt)` — closest to Lisbon, the
     first launch city. (Latency to Mexico City/Bangkok is fine for v1.)
   - Free plan is enough for all of v1.
3. Wait ~2 minutes while it provisions.

## 2. Get the two app keys (~1 min)

1. In the project: **Project Settings** (gear, bottom-left) → **API Keys** /
   **Data API** section.
2. Copy two values:
   - **Project URL** — looks like `https://abcdefghijklm.supabase.co`
   - **anon / publishable key** — the long key marked _anon_ _public_ (newer dashboards
     label it "publishable", starting `sb_publishable_…`; either works)
3. These two are **safe to put on a phone** — they're designed to ship in the client, and
   every privacy rule is enforced by RLS in the database, not by key secrecy.
   ⚠️ Do **not** copy the `service_role` / secret key anywhere — that one bypasses RLS and
   belongs only in server-side Supabase config.

## 3. Wire the app (~1 min)

On any machine with the repo cloned:

```bash
cp .env.example .env
```

Edit `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Then `npx expo start` — the Profile tab will show "Supabase: connected via .env".
(`.env` is gitignored; never commit it.)

## 4. Apply the database migrations (~5 min)

This creates every table, policy, trigger, and the 9k-city dataset. Two options:

**Option A — run it yourself (from the repo directory):**

```bash
npx supabase login                      # opens the browser once
npx supabase link --project-ref YOUR-PROJECT-REF   # ref = the part before .supabase.co
                                        # prompts for the database password from step 1
npx supabase db push                    # applies everything in supabase/migrations/
```

**Option B — have Claude do it:** create a personal access token at
[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) and
paste it into the session along with the project ref and DB password. (Treat the token as
disposable — revoke it afterwards from the same page.)

## 5. Auth settings (~4 min)

In the dashboard: **Authentication → Sign In / Providers → Email**:

- For fast early testing, turn **off** "Confirm email" (the app handles both modes, but
  off means instant sign-ups on TestFlight). Turn it back on before public launch.
- Leave **Email OTP expiration** at its default of `3600` seconds and **Email OTP length**
  at `6`. The reset-code screen says "six-digit" and "good for an hour" and flips its own
  copy at that age; change either number here and the app's words go stale.

Apple Sign-In stays off until the Apple Developer account exists — email auth works today.

### The password-reset mail carries a code, not a link

**Authentication → Email Templates → Reset Password.** The app's "Forgot your password?"
path (`src/app/(auth)/email.tsx` → `src/app/(auth)/reset-code.tsx`) asks for six digits
typed from the mail, and Supabase's default template does not print them: it prints a link.
Replace the template body with this, exactly:

```html
<h2>Reset your password</h2>
<p>Type this code into Samewhere to set a new password:</p>
<p style="font-size: 32px; letter-spacing: 8px; font-family: monospace;">{{ .Token }}</p>
<p>It is good for an hour. If you did not ask for this, ignore this email and nothing changes.</p>
```

Subject: `Your Samewhere code`.

**Take the link out; do not add the code under it.** `{{ .ConfirmationURL }}` and
`{{ .Token }}` are the SAME token on the server (GoTrue keeps one recovery hash per user
and either path consumes it), so a template that keeps the link beside the code keeps the
problem the code exists to fix: Outlook Safe Links, corporate gateways and mail scanners
fetch every URL before the person sees the mail, that fetch spends the link, and the six
digits die with it. The person then types a code the server has already used and reads
"That code is not right, or it has run out."

What still works without this edit: nothing breaks, it is only slower. A mail sent from the
old template carries a link, the reset-code screen says "Got a link and no code? Open the
email on the phone that has Samewhere on it and tap the link", and the link path
(`samewhere://reset-password`, kept in **Authentication → URL Configuration → Redirect
URLs**) opens the app on the same set-a-new-password screen the code reaches. A laptop
cannot open that link, which is why the code is the path.

`{{ .Token }}` is the only variable the body needs. `{{ .SiteURL }}`, `{{ .TokenHash }}` and
`{{ .ConfirmationURL }}` all stay out of it.

## 6. Deploy the Edge Functions (~3 min, optional but recommended)

Push notifications and Claude moderation run as Supabase Edge Functions:

```bash
npx supabase functions deploy push-worker
npx supabase functions deploy moderation-worker
npx supabase functions deploy delete-account   # required for App Review 5.1.1(v)
```

**Or skip all of this**: the repo's GitHub Actions pipeline does migrations
_and_ all three functions in one go — see
[`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) step 0. It's the supported path when
you're not at a computer.

Then in the dashboard: **Edge Functions → each function → add a schedule** (every minute).
Details: [`supabase/functions/README.md`](../supabase/functions/README.md).

**When a push does not arrive, ask the queue.** `push-worker` keeps every Expo refusal
(`InvalidCredentials` with no APNs key on EAS, `MessageTooBig`, `MessageRateExceeded`) on
the row instead of stamping it sent: `push_queue.attempts` counts the ticks that tried it and
`push_queue.last_error` names the refusal, and the worker gives up after ten with both still
on the row. `select last_error, count(*) from public.push_queue where last_error is not
null group by 1;` in the SQL Editor is the one query; the same names are in the function's
log, one line per error per tick.

**To turn on live Claude moderation** (first-message classification, photo review, selfie
verification) you additionally need an Anthropic API key
([console.anthropic.com](https://console.anthropic.com) → API keys):

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key
```

then flip the feature flags (SQL Editor):

```sql
update public.app_config set value = 'true' where key = 'require_llm_moderation';
update public.app_config set value = 'true' where key = 'require_photo_moderation';
```

Order matters: deploy + schedule + secret FIRST, then the flags — while a flag is on,
messages/photos wait for the worker's verdict and nothing is delivered unscreened. Skip
this entirely for now if you want: the built-in regex pre-filter keeps blocking the
obvious cases, and selfie verification simply stays "in review" until the worker runs.

## 7. Verify (~1 min)

1. `npx expo start`, open in Expo Go, create an account, complete onboarding.
2. In the dashboard **Table Editor**: you should see your row in `users`, `profiles`,
   your photo in `profile_photos`, and the four launch cities in `launch_cities`.
3. Optional demo seed — 3 curated pins on the Lisbon map (SQL Editor → run):

```sql
insert into public.pins (user_id, city_id, venue_name, category, lat, lng,
                         intent_date, expires_at, seeded, seed_note)
select null, lc.city_id, v.venue, v.cat::public.pin_category, v.lat, v.lng,
       current_date, now() + interval '48 hours', true, v.note
from public.launch_cities lc
join public.cities c on c.id = lc.city_id and c.name = 'Lisbon'
cross join (values
  ('LX Factory night market', 'other',  38.7025, -9.1782, 'Open-air market — travelers meet at the main gate, 7pm'),
  ('Pensão Amor',             'bar',    38.7071, -9.1458, null),
  ('Miradouro Santa Catarina','monument',38.7089, -9.1487, 'Classic sunset spot — bring a drink')
) as v(venue, cat, lat, lng, note);
```

## What still needs nothing / other keys

| Works immediately with just these keys           | Needs something else later                                        |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Sign-up, onboarding, profiles, photos            | Apple Sign-In (Apple dev account)                                 |
| Trips, matching, requests, moderation pre-filter | Push delivery on device (Apple dev + EAS build)                   |
| The map, pins, heatmap, seeded pins              | Claude moderation + selfie verification (`ANTHROPIC_API_KEY`, §6) |
| Realtime chat, block/report/unmatch              | PostHog metrics (`EXPO_PUBLIC_POSTHOG_API_KEY` in `.env`)         |
| Strike system, suspensions, admin report queue   |                                                                   |
