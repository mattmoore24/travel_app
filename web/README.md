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
- `TEAMID` must be replaced with the real Apple Team ID (App Store Connect →
  Membership). Until it is, the file is valid JSON that matches nothing.

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
