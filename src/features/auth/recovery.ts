/**
 * Reading a Supabase recovery link.
 *
 * The client is configured with `detectSessionInUrl: false`, which is right
 * for a native app — there is no browser URL to watch — but it means nothing
 * picks the tokens out of the link Supabase mails. This does.
 *
 * Supabase puts them in the URL FRAGMENT on the implicit flow
 * (`samewhere://reset-password#access_token=...&type=recovery`) and in the
 * query string on some clients, so both are read. A fragment never reaches a
 * server, which is the point of putting them there.
 */
export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string };

function paramsFrom(url: string): URLSearchParams {
  const merged = new URLSearchParams();
  // Everything after the first '#' is the fragment; everything between the
  // first '?' and that is the query. Both are 'k=v&k=v'.
  const hash = url.indexOf('#');
  const fragment = hash >= 0 ? url.slice(hash + 1) : '';
  const beforeHash = hash >= 0 ? url.slice(0, hash) : url;
  const question = beforeHash.indexOf('?');
  const query = question >= 0 ? beforeHash.slice(question + 1) : '';
  for (const part of [query, fragment]) {
    if (part.length === 0) {
      continue;
    }
    for (const [key, value] of new URLSearchParams(part)) {
      merged.set(key, value);
    }
  }
  return merged;
}

/**
 * Null for any link that is not a password recovery — including ordinary
 * deep links into the app, which must pass through untouched.
 */
export function parseRecoveryLink(url: string | null | undefined): RecoveryLink | null {
  if (!url || !/reset-password/.test(url)) {
    return null;
  }
  const params = paramsFrom(url);

  // An expired or already-used link comes back as an error, and saying so is
  // the whole difference between "try again" and a screen that does nothing.
  const error = params.get('error_description') ?? params.get('error');
  if (error) {
    return { kind: 'error', message: humanize(error) };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken };
  }
  return null;
}

function humanize(raw: string): string {
  const text = raw.replace(/\+/g, ' ');
  if (/expired|invalid/i.test(text)) {
    return 'That link has expired. Ask for a new one and open it within the hour.';
  }
  return 'That link did not work. Ask for a new one.';
}
