/**
 * Where Samewhere lives on the web.
 *
 * Everything that has to survive leaving the app goes through here: an invite
 * somebody pastes into WhatsApp, a password-reset link opened on a laptop, the
 * two URLs App Store Connect requires as submission fields.
 *
 * The domain is `samewhere.io`. `samewhere.com` belongs to somebody else, which
 * is also why the bundle identifier is `com.mattmoore.samewhere` — see
 * docs/NAMING.md.
 *
 * WHY THE RESET LINK IS STILL A CUSTOM SCHEME
 * -------------------------------------------
 * A universal link only opens the app once BOTH of these are true:
 *   1. `apple-app-site-association` is served from https://samewhere.io, over
 *      TLS, as application/json, with no redirect; and
 *   2. `associatedDomains` ships in a real build, which is an EAS build and not
 *      an over-the-air update.
 * Until then an https reset link opens Safari and hits a 404, whereas the
 * scheme below still works on the device the mail was opened on. So the switch
 * is deliberately one line, made when /reset is live and the build has shipped,
 * not before. `src/features/auth/recovery.ts` already parses both the fragment
 * and the query, so it needs no change when the flip happens.
 */

export const WEB_ORIGIN = 'https://samewhere.io' as const;

/** Hosted pages. `/privacy` and `/support` are App Store Connect form fields. */
export const WebLinks = {
  privacy: `${WEB_ORIGIN}/privacy`,
  support: `${WEB_ORIGIN}/support`,
  /** The public landing for a group invite: "Open in Samewhere" plus a store link. */
  invite: (token: string) => `${WEB_ORIGIN}/i/${encodeURIComponent(token)}`,
  reset: `${WEB_ORIGIN}/reset`,
} as const;

/**
 * Flip to true in the same commit that ships `associatedDomains` in an EAS
 * build, once https://samewhere.io/.well-known/apple-app-site-association is
 * live. Until then every outward-facing link keeps the behaviour that works
 * today rather than the one that will work later.
 */
export const UNIVERSAL_LINKS_LIVE = false as const;

/** Where Supabase should send a recovery link back to. */
export const PASSWORD_RESET_REDIRECT: string = UNIVERSAL_LINKS_LIVE
  ? WebLinks.reset
  : 'samewhere://reset-password';
