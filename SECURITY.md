# Security policy

Samewhere is a travel app that puts people in touch with each other. The data
it holds is small in volume and unusually sensitive in kind: where somebody
plans to be, who they are willing to be seen by, and the first thing they said
to a stranger. Reports about it are welcome and taken seriously.

## Reporting a vulnerability

Email **hello@samewhere.io** with:

- what you found and where,
- the steps to reproduce it,
- what an attacker gets out of it.

Please **do not** open a public GitHub issue for a security report, and please
do not access, modify or retain another person's data while demonstrating
something. A description of the reachable path is worth more to us than a
dump proving it.

We will acknowledge within **3 working days** and tell you what we intend to do
within **10**. This is a small project and there is no bounty programme; there
is credit in the fix's commit message if you would like it, and honest thanks
if you would not.

## Scope

In scope:

- the mobile app (iOS, TestFlight and App Store),
- the Supabase project behind it: RLS policies, RPCs, Edge Functions, storage,
- the marketing and legal site under `web/`,
- this repository's CI workflows.

Out of scope:

- denial of service by volume, and anything that only demonstrates that a rate
  limit can be reached,
- findings from automated scanners with no reachable path shown,
- vulnerabilities in Supabase, Expo, Apple or other vendors themselves — report
  those to the vendor; tell us too if our configuration is what exposes them,
- social engineering of anyone involved.

## What we have already looked at

`docs/security/SECURITY_AUDIT.md` is a real audit with the findings, the
severities, the fixes and — deliberately — a section listing what has **not**
been assessed yet. If you are looking for somewhere to start, that section is
an honest list of where the gaps most likely are.

## Design commitments

These are product rules, not implementation details, and they are enforced in
the database rather than in the client
(`docs/PRODUCT_BRIEF.md` §7):

- **No live location, ever.** The app has no continuous location tracking and
  no device-location broadcast. A pin is a place somebody chose to name.
- **Pins expire.** Nothing a person shares about where they will be outlives
  the plan it belongs to.
- **First messages are moderated before delivery**, and a held message is
  invisible to its recipient rather than delivered and retracted.
- **Social handles are gated in the database**, not hidden in the UI.
- **The heat map has a k-threshold**: a cell that would identify a person is
  not drawn.

If you find a path that breaks one of these, treat it as a vulnerability report
even if no data is exposed by it. The rule _is_ the security property.
