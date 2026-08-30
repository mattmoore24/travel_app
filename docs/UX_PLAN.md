# UX implementation plan

The build plan that comes out of [`UX_AUDIT.md`](UX_AUDIT.md). It exists to be signed
off: the decisions are at the top because several of them change what the work is, and one
of them changes whether most of it can start at all.

## How this was produced

Twenty-two independent reports (fifteen auditors across the product surfaces, seven
covering the ground a screen-by-screen sweep structurally misses), then a verification
pass whose only instruction was to refute what the auditors wrote.

**436 findings. 435 verified.**

| Verdict                   | Count | What it means here                                                                                          |
| ------------------------- | ----: | ----------------------------------------------------------------------------------------------------------- |
| Confirmed                 |   293 | Somebody opened the file or the screenshot and saw it                                                       |
| Corrected in detail       |   120 | The problem is real, some detail was wrong; the corrected version is what got planned                       |
| Recorded founder decision |    13 | True, but the current behaviour is a decision you already made. Raised as a question, never planned as work |
| Refuted                   |     9 | Not true. Dropped                                                                                           |

Thirteen subsystem planners then merged those findings into work packages, with one
instruction that shapes everything below: **a package that closes six findings is a better
package than six that close one each.** They were required to open the real files before
naming them, and to say for each package what changes, what migration it needs, what test
proves it, and whether it ships over the air or costs an EAS build.

The nine refutations are worth a sentence, because each was a plausible, well-argued claim
that would have sent somebody to fix something that is not broken. The most serious was a
report that `featured_traveler` ignores the audience setting and is granted to `anon`,
which would have been a privacy-invariant break. It is false: the function ends
`and public.discovery_pair_ok(auth.uid(), t.user_id)`, `audience_admits` carries the
comment _"p_user null (a guest) is admitted by 'everyone' and by nothing else"_, and
`supabase/tests/database/17_profile_visibility.test.sql:286` already asserts exactly that
case with the words _"a narrowed audience is never the traveler a guest is shown"_. No
work is warranted, and nothing below references it.

## How to read a package

Every package carries the same fields.

- **Changes** — one line per file, specific enough to build from.
- **DB** — the migration, or none. Where a migration changes a function's OUT columns it
  says so, because this repo has already paid for a deploy that half-applied:
  `drop function` first, then re-state grants.
- **Tests** — pgTAP for a database invariant, unit tests for logic, the E2E suite and a
  re-shot screenshot for anything a picture would catch.
- **Ships as** — `ota` (JavaScript over the air), `ota+supabase`, `supabase-only`, or
  `eas-build`. An EAS build is only for native or config changes, so packages that need
  one are worth batching.
- **Effort** — S is under an hour, M is a sitting, L is a project.

Priorities are `now` (cheap and clearly right), `next` (real work, clear payoff) and
`later` (genuinely optional).
