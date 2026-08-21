/**
 * Is this request from the scheduler, or from anybody at all?
 *
 * The three cron workers run with the service role: they read the push queue,
 * the moderation backlog and the support inbox, all of which are server-only
 * tables. They took no request argument, which meant they ran for whoever
 * asked — and a Supabase function accepts the ANON key as a valid JWT by
 * default, and the anon key ships inside the app. Anyone who pulled it out of
 * the IPA could drive them in a loop: real push notifications sent early, the
 * classifier's budget spent, the support mailer fired.
 *
 * pg_cron calls these with the service role key from the vault
 * (invoke_edge_worker), so that is the credential to require. Compared as
 * SHA-256 digests, which is fixed-length and gives a would-be caller nothing
 * to time.
 */

const encoder = new TextEncoder();

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function isServiceCaller(req: Request): Promise<boolean> {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    return false;
  }
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return false;
  }
  const [a, b] = await Promise.all([digest(token), digest(key)]);
  return a === b;
}

/** The one answer these workers give anybody else. Deliberately terse. */
export function refuse(): Response {
  return Response.json({ error: 'not authorized' }, { status: 401 });
}
