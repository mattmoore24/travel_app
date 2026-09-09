# What samewhere can be made to spend

Written 2026-09-06 on branch `security-hardening`. Every figure below was read
from the code at the line cited, not estimated from memory.

The question this document answers is not "is the app efficient". It is:
**if somebody set out to run up the bill, or if the app simply succeeded, what
is the largest number that could appear on an invoice, and what refuses it?**

---

## The short version

| Vector                                                               | Bounded before?                | Bounded now                              |
| -------------------------------------------------------------------- | ------------------------------ | ---------------------------------------- |
| Moderation model calls                                               | Throughput yes, **spend no**   | 2,000 calls/day, claimed before spending |
| Chat photos per account                                              | 200 standing objects only      | 120/day                                  |
| Upload size                                                          | **No** (bucket limit was null) | 5 MB, `image/jpeg` + `image/png`         |
| Pins, trips, messages, reports, blocks, profile edits, verifications | Yes                            | unchanged                                |
| Push sends                                                           | Per-account token cap (5)      | unchanged                                |
| Database egress                                                      | Not directly bounded           | still not; see "Left open"               |

Two of those rows were the whole finding. Everything else in this app was
already capped, in a trigger, by somebody who had thought about it.

---

## 1. The moderation pipeline — the only per-activity spend in the app

`supabase/functions/moderation-worker/index.ts` classifies with Claude Opus 5
(`MODEL`, line 48) at `max_tokens: 16000`. Nine queues drain per tick, each
`.limit()`ed:

| Queue             | Per tick | Constant                 |
| ----------------- | -------- | ------------------------ |
| Chat photos       | 8        | `CHAT_PHOTOS_PER_TICK`   |
| Held first hellos | 10       | `MESSAGES_PER_TICK`      |
| Profile photos    | 5        | `PHOTOS_PER_TICK`        |
| Business photos   | 5        | `PHOTOS_PER_TICK`        |
| Post photos       | 5        | `PHOTOS_PER_TICK`        |
| Group photos      | 5        | `PHOTOS_PER_TICK`        |
| Selfies           | 3        | `VERIFICATIONS_PER_TICK` |
| Storefronts       | 3        | `STOREFRONTS_PER_TICK`   |
| Impersonation     | 3        | `SCANS_PER_TICK`         |
| **Total**         | **47**   |                          |

The cron is `* * * * *` — every minute
(`supabase/migrations/20260817230000_schedule_workers.sql:74`). So:

```
47 calls/tick x 1440 ticks/day = 67,680 model calls per day
```

**What that was worth.** Opus 5 is $5.00/1M input and $25.00/1M output. Most of
these calls carry an image and run at `CAREFUL` effort with adaptive thinking,
so a few thousand input tokens and one to a few thousand output. Call it
$0.02–$0.07 a call and the ceiling is **roughly $1,400–$4,700 a day**, or
$40k–$140k a month, sustained, with nothing anywhere refusing the next call.

### The thing that was easy to mistake for a budget

`TICK_BUDGET_MS = 50_000` and the nine `QUEUE_BUDGET_MS` slices are real and
they do hold the number below 67,680 in practice — a queue only gets its slice
of the clock, so a `CAREFUL` image classification at five seconds means its
queue starts one or two items, not five.

That is a **latency device**. It exists, by its own comment, so a slow queue
cannot starve the one behind it. It reduces spend the way a narrow doorway
reduces how fast a room fills: incidentally, and not at all once the room has
all day. Reading it as a cost control is the mistake this section exists to
name.

### What bounded it: per-account caps

These are real, they are all DB triggers, and they are the reason the app was
never at risk from _one_ hostile account:

| Cap                   | Limit               | Where                               |
| --------------------- | ------------------- | ----------------------------------- |
| First messages        | 8/day               | `app_config first_messages_per_day` |
| Messages (any)        | 30/minute           | `throttle_messages`                 |
| Profile photo inserts | 25/day              | `throttle_photos`                   |
| Pins                  | 30/day, 10 standing | `throttle_pins`, `map_pins`         |
| Trips                 | 5 standing          | `trips_matching`                    |
| Reports               | 10/day              | `throttle_reports`                  |
| Blocks                | 50/day              | `throttle_blocks`                   |
| Profile text edits    | 30/day              | `screen_profile_text`               |
| Verification attempts | capped              | `trust_safety:798`                  |
| Storage objects       | 30 / 200 / 10       | `own_object_count` policies         |

What none of them bound is **N accounts**. The queue is the bill, and a cap on
what one account may add to the queue is not a cap on the queue.

### The gap inside the per-account caps

Profile photos were given a daily velocity cap in 20260817150000 with this
reasoning, quoted because it is exactly right:

> the 7-slot cap bounds standing rows, not delete/re-insert churn — and with
> photo moderation on, every insert is an LLM classification, so churn is also
> a cost amplifier.

**Chat photos never got the same treatment.** Their only bounds were
`own_object_count('chat-photos') < 200` — a _standing_ cap, satisfied afresh
after every delete — and `throttle_messages`' 30 a minute, which is 43,200
photo messages a day from a single account: on its own, more than the entire
pipeline's daily ceiling.

### What is there now

`supabase/migrations/20260906100000_a_budget_that_says_no.sql`:

- **`app_config.moderation_daily_call_cap`**, default **2000**, and
  **`moderation_paused`**, a kill switch checked before the counter.
- **`moderation_spend`** — one row per UTC day. RLS on, no policies, revoked
  from `anon` and `authenticated`: the deny-all shape `app_config` uses.
- **`claim_moderation_budget(int)` / `release_moderation_budget(int)`** —
  service-role only, by grant _and_ by an `assert_service_caller()` runtime
  guard that is tested independently of the grant.
- The worker claims a tick's worth **before reading a single row**, spends it
  through the same per-item gate that spends the clock, and hands the remainder
  back through a `respond()` helper every one of its eleven exits goes through.
- **Chat photos: 120/day**, counted on `messages.image_path`, with a partial
  index to match.

**Claim-then-release, and the asymmetry is deliberate.** If the isolate is
killed mid-tick — the failure `TICK_BUDGET_MS` exists for — the release never
runs and the day is charged for calls that were never made. A killed worker
therefore _under-spends_ the cap instead of escaping it. Counting after each
call would fail the other way.

**Hitting the cap is not a safety event.** A queue that cannot claim stops
selecting rows, so content stays `pending` — held, undelivered, unshown. The
degradation is latency and never an approval. There is no branch in the worker
that approves anything when the budget is gone, and
`src/app/__tests__/moderation-worker-queues.test.ts` asserts it by looking for
`.rpc('apply_` in the refusal block rather than by reading prose.

### Sizing the cap, and the one way this bites

2,000/day is about a hundred times current TestFlight traffic and about
thirty-four times below the old ceiling. It is one `UPDATE` to raise:

```sql
update public.app_config set value = '20000'
where key = 'moderation_daily_call_cap';
```

**Raise it before launch.** A cap sized for TestFlight will hold real users'
first hellos on the day the app opens, and the symptom — held messages, nothing
in the logs that looks like an error — is the exact symptom this pipeline has
produced before for other reasons. `select * from public.worker_status();` now
reports the day's count, the ceiling and whether the pause flag is on, so the
question "have we run out of budget" is answerable in one query. It is on
`MANUAL_CHECKLIST.md`.

---

## 2. Uploads

Every one of the five storage buckets is **private** (`public = false`), which
is the half that is usually got wrong and was right here. What none of them had
was a size or content-type limit — verified live:

```
select id, public, file_size_limit, allowed_mime_types from storage.buckets;
-- five rows: public=false everywhere, null and null everywhere.
```

Null means "whatever the project allows", and the project's ceiling is a
dashboard number in the tens of megabytes. So the standing object caps (30
profile photos, 200 chat photos, 10 selfies) bound the _count_ and say nothing
about the size — and thirty objects with no size limit is not a bound on
anything billable. A large image is also a more expensive classification.

Null `allowed_mime_types` additionally means a signed URL out of these buckets
can be served as `text/html`. The app renders them through `<Image>`, so nothing
in the product is at risk; a signed URL opened in a browser is another matter,
and it is a link somebody can be sent.

`20260906110000_a_bucket_says_what_it_takes.sql` sets **5 MB** and
**`image/jpeg` + `image/png`** on all five. The allowlist can be this narrow
because every upload from the app goes through one function —
`processAndUploadImage` (`src/lib/image-upload.ts:217`) — which resizes to
1440px, re-encodes JPEG at quality 0.8 and uploads with
`contentType: 'image/jpeg'`. No edge function uploads at all. PNG is on the
list for the one other writer: `scripts/seed-demo-travelers.mjs:200` PUTs
`image/png`, and 12 of the 16 live objects in `profile-photos` are PNGs — a
jpeg-only list would have broken the demo seeder silently, because its upload
sits in a `try/catch` that logs a warning and lets the script exit 0. What is
being closed here is _any_ content type on a signed URL (`text/html`,
`application/javascript`), not any image format; `image/svg+xml` can carry
script and is deliberately not on the list. **A file in these buckets that is
neither a JPEG nor a PNG did not come from this app.**

---

## 3. Left open, on purpose, and named

- **Database egress and row reads.** `city_pins`, `heat_cells` and `get_matches`
  are `authenticated`-only and bounded per call, but nothing rate-limits how
  often a client asks. This is Supabase-plan-level spend, is not amplified by
  any per-call cost, and the honest fix is a Supabase spend cap in the
  dashboard rather than a trigger. On `MANUAL_CHECKLIST.md`.
- **Auth emails and OTP sends.** Governed by Supabase's own auth rate limits,
  which are dashboard settings this repo cannot assert. On the checklist.
- **PostHog event volume.** Not yet assessed. Named in `SECURITY_AUDIT.md`
  under "not yet assessed" rather than implied to be fine.
- **A spend cap at the vendor.** Every control above is ours and can be wrong.
  An Anthropic Console spend limit is the one that holds when ours does not,
  and it is the first item on `MANUAL_CHECKLIST.md`.
