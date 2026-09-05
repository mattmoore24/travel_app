/**
 * Where Samewhere lives on the web.
 *
 * Everything that has to survive leaving the app goes through here: an invite
 * somebody pastes into WhatsApp, a password-reset link opened on a laptop, the
 * two URLs App Store Connect requires as submission fields.
 *
 * THE HOST IS `link.samewhere.io`, NOT THE APEX. Cloudflare Pages serves the
 * pages and the association file from the subdomain; the apex and `www` stay
 * on Squarespace so the Google Workspace mail records are not disturbed. See
 * web/README.md. `samewhere.com` belongs to somebody else, which is also why
 * the bundle identifier is `com.mattmoore.samewhere` — see docs/NAMING.md.
 *
 * WHY THE RESET LINK IS STILL A CUSTOM SCHEME
 * -------------------------------------------
 * Supabase's recovery mail 302s to PASSWORD_RESET_REDIRECT. Today that is
 * `samewhere://reset-password`, which hands the tokens straight to the app,
 * fragment intact. That works with or without universal links.
 *
 * Flipping the flag below is NOT one line. Before it can be true, all four of
 * these have to hold, the first three in one commit:
 *   1. `/reset*` back in web/.well-known/apple-app-site-association — it is
 *      deliberately absent, because a declared path with no route burns the
 *      single-use token on +not-found;
 *   2. a route answering the path `/reset`, because the app's screen is at
 *      /reset-password and an unmatched path lands on +not-found;
 *   3. `parseRecoveryLink` matching `/reset` as well as `/reset-password`
 *      (already widened — src/features/auth/recovery.ts);
 *   4. `https://link.samewhere.io/reset` in Supabase's redirect allowlist —
 *      it is there, next to the scheme. Anything NOT on that list is silently
 *      replaced by the Site URL, which is how a wrong host fails with no
 *      error anywhere.
 * A recovery token is single use, so getting this wrong does not bounce
 * somebody, it spends their reset. Leaving the flag false costs nothing: the
 * hosted /reset page already bridges a laptop click back to the scheme.
 */

export const WEB_ORIGIN = 'https://link.samewhere.io' as const;

/** Hosted pages. `/privacy` and `/support` are App Store Connect form fields. */
export const WebLinks = {
  privacy: `${WEB_ORIGIN}/privacy`,
  support: `${WEB_ORIGIN}/support`,
  /** The public landing for a group invite: "Open in Samewhere" plus a store link. */
  invite: (token: string) => `${WEB_ORIGIN}/i/${encodeURIComponent(token)}`,
  reset: `${WEB_ORIGIN}/reset`,
} as const;

/** Read the four preconditions above before touching this. */
export const UNIVERSAL_LINKS_LIVE = false as const;

/** Where Supabase should send a recovery link back to. */
export const PASSWORD_RESET_REDIRECT: string = UNIVERSAL_LINKS_LIVE
  ? WebLinks.reset
  : 'samewhere://reset-password';
