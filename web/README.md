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

Only after the AASA file is live and verified — 200, `application/json`, zero
redirects:

1. `app.json` → `ios.associatedDomains: ["applinks:link.samewhere.io"]` AND
   the route `src/app/i/[token].tsx`, in the SAME commit. iOS routes an https
   link by PATH alone (expo-router registers `prefixes: []` and does no host
   check), so a declared pattern with no route under `src/app` opens the app
   on +not-found. That screen says the link expired, which is a lie, and it
   also stops the page under `/i/` from ever rendering on a phone that has
   the app. DONE.
2. An **EAS build**, because `associatedDomains` is native config and cannot
   ship over the air. Before submitting it, check the copy iOS actually
   reads, not just the origin:

   ```
   curl -sS https://app-site-association.cdn-apple.com/a/v1/link.samewhere.io
   ```

   must show exactly one component, `/i/*`. A 404 means Apple has never
   crawled the file, which is also fine. Five components means Apple cached
   the old file; wait for the cache to turn over (up to a day) before
   submitting, or every install claims paths the app cannot answer for the
   life of that cache.

Leave `UNIVERSAL_LINKS_LIVE` in `src/constants/links.ts` **false**. The
recovery mail's own 302 already hands `samewhere://reset-password` to the
app with the fragment intact; that works with or without universal links,
and `/reset*` is deliberately not in the association file. Flipping the flag
needs four things at once, listed in the header of `src/constants/links.ts`.
A recovery token is single use, so getting it wrong spends somebody's reset
rather than bouncing them.

Supabase → Auth → URL Configuration → redirect allowlist holds
`https://link.samewhere.io/reset` and `samewhere://reset-password`. Keep
BOTH: anything not on that list is silently replaced by the Site URL.

### The paths the association file declares

One: `/i/*`. `/b/*`, `/c/*` and `/u/*` were dropped on 2026-08-30 — no page
under `web/`, no route under `src/app`, and no city screen exists in any
form. Pre-declaring them bought nothing: `associatedDomains` is per-DOMAIN,
so a path added later is an AASA edit plus a JS route, which is an
over-the-air update and never a new build.
`src/app/__tests__/invite-links.test.ts` asserts the list, so adding a
pattern means adding its route in the same commit.

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
