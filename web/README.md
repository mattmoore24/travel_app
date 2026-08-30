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
curl -sI https://samewhere.io/.well-known/apple-app-site-association | head -3
curl -s  https://samewhere.io/.well-known/apple-app-site-association | jq .
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

1. `app.json` → `ios.associatedDomains: ["applinks:samewhere.io"]`
2. `src/constants/links.ts` → flip `UNIVERSAL_LINKS_LIVE` to `true`
3. Supabase → Auth → URL Configuration → add `https://samewhere.io/reset` to
   the redirect allowlist, or the recovery 302 is refused
4. An **EAS build**, because `associatedDomains` is native config and cannot
   ship over the air

Doing step 2 before the file is live replaces a reset link that works on the
phone with one that opens Safari and 404s. That is why the flag exists.

## 4. Routing: `_redirects`, `404.html`, and the not-found trap

The live host is **`link.samewhere.io`**, not the apex. `src/constants/links.ts`
still says `https://samewhere.io`; that constant is wired up separately, once the
origin is confirmed end to end.

Two config files are read by the host and are never served as content:

- `_headers` gives the association file its `application/json` type. It is
  verified working: the file returns 200, the right type, and zero redirects.
- `_redirects` rewrites `/i/<token>` and `/reset/<anything>` onto their pages
  with a 200, so the token stays in the URL for the page's JS to read.

**The trap.** A static host with an `index.html` in the output root and no
`404.html` treats the root page as a catch-all: every unmatched path returns it
with a **200**, not a 404. That is what `a5b4fdd` shipped, and it is why
`/i/<token>` rendered the home page. `/nope-xyz`, `/nope.json` and
`/deep/nested/nope` all returned the same 1181-byte root page.

Two things fix it, and both are in the tree:

1. `_redirects` now targets the **directory** (`/i/`), not `/i/index.html`. An
   asset stored at `i/index.html` is canonically addressed as `/i/`, and a
   rewrite aimed at the uncanonical path can fail to resolve and fall through to
   not-found handling.
2. `404.html` exists, which replaces catch-all-the-root with real 404 handling.
   It also renders the invite itself when the path looks like `/i/<token>`, so an
   invite opens even if the rewrite is still not applied. That path costs a 404
   status the reader never sees, so it is a safety net, not the intended route.

Because `curl` does not run JS, the `<title>` says which route actually served a
request, which is the fastest way to tell these apart:

| Title on `/i/testtoken`             | Meaning                                          |
| ----------------------------------- | ------------------------------------------------ |
| `You have been invited · Samewhere` | `_redirects` is working. Intended route.         |
| `Not found · Samewhere`             | Rewrite still ignored; the safety net caught it. |
| `Samewhere`                         | Neither change deployed.                         |

If the middle row is what shows, the next step is Pages Functions
(`functions/i/[[path]].ts`), which run ahead of asset routing and do not depend
on the rewrite being honoured at all.

Verify the whole surface after any deploy:

```
for p in / /privacy /support /i/testtoken /reset /reset/foo /nope-xyz; do
  printf '%-16s ' "$p"
  curl -s -o /dev/null -w 'code=%{http_code} redirects=%{num_redirects} ' \
    "https://link.samewhere.io$p"
  curl -s -L "https://link.samewhere.io$p" | grep -o '<title>[^<]*</title>'
done
curl -sI https://link.samewhere.io/.well-known/apple-app-site-association | head -3
```

`/privacy`, `/support` and `/reset` are live App Store Connect and Supabase
values. They must keep resolving, and the association file must stay 200 /
`application/json` / zero redirects, whatever else changes here.
