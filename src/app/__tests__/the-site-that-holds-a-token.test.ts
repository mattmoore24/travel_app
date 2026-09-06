import fs from 'node:fs';
import path from 'node:path';

/**
 * The static site handles credentials, so its headers are not decoration.
 *
 * `/reset` is where a Supabase password-recovery token lands. The page reads
 * `window.location.hash` — and, when Supabase uses the query string instead,
 * `window.location.search` — and hands the whole tail to the app through a
 * `samewhere://` deep link. `/i` does the same for invite links. Both run
 * inline script to do it, and until 20260906 the origin served them with no
 * security headers whatsoever: no CSP, nothing that stopped the page being
 * framed, and a default `Referrer-Policy` that will put a query string in a
 * `Referer` header.
 *
 * A `_headers` file is the kind of thing that gets truncated during an
 * unrelated edit and nobody notices for a year, because nothing renders
 * differently. This is the thing that notices.
 */
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const headers = fs.readFileSync(path.join(WEB, '_headers'), 'utf8');

/** The header block Cloudflare applies to a path, as one string. */
function blockFor(rule: string): string {
  const lines = headers.split('\n');
  const at = lines.findIndex((line) => line.trim() === rule);
  if (at < 0) throw new Error(`no _headers rule for ${rule}`);
  const out: string[] = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || !line.startsWith(' ')) break;
    if (!line.trim().startsWith('#')) out.push(line.trim());
  }
  return out.join('\n');
}

describe('the pages that carry a token are served with headers that say so', () => {
  const everyPage = blockFor('/*');

  it('blocks the exfiltration path rather than only the injection one', () => {
    // connect-src is absent ON PURPOSE so it inherits default-src 'none':
    // script on this origin cannot fetch, XHR or WebSocket a recovery token
    // anywhere. A CSP that allowed connect-src would still stop a foreign
    // <script src> and would not stop the thing that actually loses the token.
    expect(everyPage).toContain("default-src 'none'");
    expect(everyPage).not.toContain('connect-src');
    expect(everyPage).toContain("form-action 'none'");
    expect(everyPage).toContain("base-uri 'none'");
  });

  it('refuses to be framed, in both spellings', () => {
    // /reset in a frame is a clickjacking target.
    expect(everyPage).toContain("frame-ancestors 'none'");
    expect(everyPage).toContain('X-Frame-Options: DENY');
  });

  it('cannot leak the token in a Referer', () => {
    // The fragment is never sent in a Referer. The QUERY STRING is, and the
    // reset page reads that too — so no-referrer is the only setting here
    // that is actually sufficient, and a weaker one would look fine.
    expect(everyPage).toContain('Referrer-Policy: no-referrer');
  });

  it('keeps the rest of the baseline', () => {
    expect(everyPage).toContain('X-Content-Type-Options: nosniff');
    expect(everyPage).toContain('Strict-Transport-Security: max-age=');
    // Hard rule 7: no live location, ever. Saying it in a header means a
    // future page cannot quietly start asking.
    expect(everyPage).toContain('geolocation=()');
  });

  it('still types the association file, which is what this file used to be for', () => {
    // iOS refuses to parse the AASA unless it arrives as application/json,
    // and the failure is silent: links just open Safari. Adding a /* rule
    // above this one must not have displaced it.
    expect(blockFor('/.well-known/apple-app-site-association')).toContain(
      'Content-Type: application/json'
    );
  });

  it('names no third party, because the site loads none', () => {
    // The policy can be this strict only while that stays true. If somebody
    // adds a font, an analytics tag or an embed, this fails and they have to
    // decide deliberately rather than discover a blank page in production.
    const external = [...headers.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]);
    expect(external).toEqual([]);
  });
});
