---
name: change-review
description: Samewhere's review and testing brief — load alongside engineering:code-review, engineering:testing-strategy, engineering:debug, engineering:tech-debt, or engineering:architecture. Supplies the privacy invariants a diff must never break, where each kind of test belongs, and what counts as evidence here. Use before shipping any change, and when deciding what to test.
---

# Reviewing a Samewhere change

Run the `engineering:*` skill you came for. This file is the brief it is
missing: a solo-founder iOS app whose whole value proposition is a set of
privacy promises, shipping to a phone through TestFlight.

## The eight rules a diff may never break

From `docs/PRODUCT_BRIEF.md` §7. These are not preferences; breaking one
without explicit founder sign-off is a defect regardless of how the code
reads.

1. Core discovery, map, matching, and messaging are **free**. No paywalls, no
   "see who liked you" mechanics.
2. **No real-time user location** is ever collected, stored, or displayed.
   Pins are venue-level _future intent_ only.
3. Pins **hard-expire at ≤72 hours** and are unreadable afterwards.
4. Social handles are **never visible pre-accept**, enforced at the DB layer.
5. **Every first message passes moderation** before delivery.
6. Heatmap cells below the k-threshold are **never rendered**.
7. Everything is committed and pushed; the project must be fully recoverable
   from a fresh clone.
8. A **business account never initiates contact** with a traveler, never joins
   a traveler's group or another business's chat, and never reads traveler
   discovery surfaces. Its reach is its listing, its posts, its chat and its
   replies.

Rule 8 was signed off on 2026-08-27 and enforced in the schema from that day —
six BEFORE INSERT triggers, `assert_not_business()`, `viewer_is_business()` and
their pgTAP attack tests all cite "§7 rule 8" — but it was only written into
the brief itself on 2026-09-01, and into this list with it. For that week the
code enforced and cited a rule neither document contained, which is how a
review reading only the brief could have passed a diff that broke it.

Review a diff against these first. A change that adds a location permission,
widens a pin's lifetime, exposes a handle earlier, or bypasses the moderation
path is a stop-the-line finding even if every test passes.

## The database is the enforcement layer

Client code is UX; Postgres is the boundary. So:

- **Check policies for enumerability, not just correctness.** A policy that
  lets a table be read in bulk defeats the feature even when no screen does
  it. This repo shipped a `trips_select_upcoming` policy that was correct for
  every screen and readable in bulk by anyone with the anon key.
- Anything security-relevant needs a **pgTAP** test that tries the attack,
  not a unit test that asserts the happy path.
- `RETURNS TABLE` functions: a migration that changes OUT columns must
  `drop function` first and re-state grants. See `traps`.
- `PostgrestError` is not an `Error`, so `if (e instanceof Error)` silently
  swallows every database message.

## Where a test belongs

| Kind of thing                                     | Where it is tested                                           |
| ------------------------------------------------- | ------------------------------------------------------------ |
| A privacy invariant, an RLS policy, a constraint  | **pgTAP** (`supabase/tests/database/`), written as an attack |
| Pure logic — date overlap, formatting, validation | **jest**                                                     |
| A whole flow a person walks                       | **Maestro** (`e2e/flows/`), against the live backend         |
| "Does it look right"                              | **Screenshots.** Nothing else answers this                   |

Do not add a jest test that mocks Supabase to prove a policy works; it proves
the mock works.

## Evidence, and what does not count as evidence

- **A green E2E run is not evidence the app looked right.** Look at the
  pictures — the `screens` skill fetches them. A run went green here on a
  screen where two form fields had been concatenated into one.
- **Never loosen an assertion to make a run pass.** That is what let the
  above through. Assert the exact text a human would read.
- A claim that something is deployed needs a run ID and the commit it came
  from. "Published" without one is a guess.

## Before pushing

```
npm run typecheck && npx expo lint && npm run format:check && npm test
```

Conventional commits, small and atomic. Never commit `.env`; never put a
`service_role` key in the client bundle or in chat; never let the moderation
classifier prompts into this repo while it is public — they live in a GitHub
secret so it cannot be read for how to evade them.

Then read `ship` to decide between an over-the-air update and an EAS build.
Builds are hosted on Expo's Starter plan and draw down real credit, so batch
native changes; JavaScript still ships over the air for free.

## Scope these down

`engineering:standup` and `engineering:incident-response` assume a team and
an on-call rotation; there is one founder and no production users yet.
`engineering:tech-debt` is useful but should be scoped against the launch
runbook in `docs/LAUNCH_RUNBOOK.md` rather than run as an open-ended audit —
the known pre-launch debts are already listed there, including flipping the
repo private, deleting the `e2e-results` branch, and purging demo travelers.
