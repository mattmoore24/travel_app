# samewhere.io — what has to be served

Four things in this app only work because a web server answers for
`samewhere.io`: universal links, the two URLs App Store Connect requires as
submission fields, the invite a traveler pastes into WhatsApp, and a password
reset opened on a laptop.

Any static host does it. Cloudflare Pages, Netlify and Vercel are all free at
this size. This directory is the content, not a build.

## 1. `/.well-known/apple-app-site-association`

Three rules, and getting any of them wrong makes it fail silently:

- **No `.json` extension.** The file is named exactly `apple-app-site-association`.
- Served as `Content-Type: application/json`, over TLS, with **no redirect**.
  A 301 to `www.` is the most common way this breaks.
- The app ID is `9GSR77B4U5.com.mattmoore.samewhere` (Team ID + bundle ID).
  A wrong Team ID makes the file valid JSON that matches nothing, silently.

Verify after deploying:

```
curl -sI https://link.samewhere.io/.well-known/apple-app-site-association | head -3
curl -s  https://link.samewhere.io/.well-known/apple-app-site-association | jq .
```

Apple's CDN caches this. A change can take a day to reach devices, and a fresh
install picks it up immediately — test on a device that has never had the app.

## 2. The pages

| Path         | What it is                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `/privacy`   | The full text of `docs/legal/PRIVACY_POLICY.md`. Required App Store Connect field.                                  |
| `/support`   | A contact page naming `hello@samewhere.io`. Required App Store Connect field.                                       |
| `/i/<token>` | Invite landing: the group's name, an "Open in Samewhere" button, and an App Store link for anybody without the app. |
| `/reset`     | Password reset landing.                                                                                             |

`/i/<token>` may render **only** what `group_invite_preview` already exposes to
`anon` — the group name and nothing else. No member list, no avatars, no
identities. And per §7 rule 4 a `/u/<id>` profile page must never render social
handles.

## 3. Then, in the app

Only after the AASA file is live:

1. `app.json` → `ios.associatedDomains: ["applinks:link.samewhere.io"]`
2. `src/constants/links.ts` → flip `UNIVERSAL_LINKS_LIVE` to `true`
3. Supabase → Auth → URL Configuration → redirect allowlist. DONE: it holds
   `https://link.samewhere.io/reset` and `samewhere://reset-password`. Keep
   BOTH until every install in the wild is past the build that sends the
   scheme.
4. An **EAS build**, because `associatedDomains` is native config and cannot
   ship over the air

Doing step 2 before the file is live replaces a reset link that works on the
phone with one that opens Safari and 404s. That is why the flag exists.

## 4. Routing: `_redirects`, `404.html`, and the not-found trap

The live host is **`link.samewhere.io`**, not the apex. Cloudflare refuses an
apex custom domain unless the whole DNS zone moves to Cloudflare, and moving it
would have risked the Google Workspace mail records; the apex and `www` stay on
Squarespace, deliberately.

Two config files are read by the host and are never served as content:

- `_headers` gives the association file its `application/json` type.
- `_redirects` rewrites `/i/<token>` and `/reset/<anything>` onto their pages
  with a 200, so the token stays in the URL for the page's JS to read.

**The trap, diagnosed from the deploy log.** `a5b4fdd` wrote the rewrite
targets as `/i/index.html`. Cloudflare canonicalises that path back to `/i/`,
sees the result re-match `/i/*`, classifies the rule as an infinite loop and
rejects it **at deploy time**: the build log read `Parsed 0 valid redirect
rules ... Infinite loop detected in this rule and has been ignored`, and the
site served with no rewrites at all. In the same block, `Parsed 1 valid header
rule` is why `_headers` worked while `_redirects` did nothing. On top of that,
a root `index.html` with no `404.html` made every unmatched path serve the
root page with a 200.

Both fixes shipped in `9abb32c`, verified live, and both are load-bearing:

1. `_redirects` targets the **directory** (`/i/`). The deploy log now reads
   `Parsed 2 valid redirect rules`. Check that line after any edit here.
2. `404.html` turns unmatched paths into real 404s. Removing it brings back
   catch-all 200s regardless of the rewrites. Its invite branch is a safety
   net that has never needed to run.

The App Store links on the pages use the real listing ID (`id6802889254`). The
store URL 404s until the app is released; do not write a check that asserts it
resolves before launch.

Verify the whole surface after any deploy:

```
for p in / /privacy /support /i/testtoken /reset /reset/foo /nope-xyz; do
  printf '%-16s ' "$p"
  curl -s -o /dev/null -w 'code=%{http_code} redirects=%{num_redirects} ' \
    "https://link.samewhere.io$p"
  curl -s -L "https://link.samewhere.io$p" | grep -o '<title>[^<]*</title>'
done
curl -s -o /dev/null -w 'aasa no -L: code=%{http_code}\n' \
  https://link.samewhere.io/.well-known/apple-app-site-association
```

Expected: `/i/testtoken` 200 with `You have been invited · Samewhere`,
`/reset/foo` 200 with `Reset your password · Samewhere`, `/nope-xyz` 404 with
`Not found · Samewhere`, and the association file 200 **without** `-L` (which
is what proves zero redirects; a `%{num_redirects}` printed without `-L` is
always 0 and proves nothing).

`/privacy`, `/support` and `/reset` are live App Store Connect and Supabase
values. They must keep resolving, and the association file must stay 200 /
`application/json` / zero redirects, whatever else changes here.
