// Sign in with Apple, server side: the client secret, the code exchange, and
// the revoke.
//
// Two functions need the same three things - store-apple-token buys a refresh
// token at sign-in, delete-account spends it - so they share this file rather
// than carrying two copies of an ES256 signer that can drift. `_shared` is the
// Supabase convention: the CLI bundles relative imports with whichever
// function pulls them in.
//
// Everything here degrades to a no-op until the Sign in with Apple key is
// provisioned (see docs/APP_STORE.md). `appleConfig()` returns null when any
// of the four secrets is missing, and both callers treat that as "nothing to
// do" rather than as a failure, because a missing key must never stop somebody
// signing in and must never stop somebody deleting their account.
//
// Secrets, set with `supabase secrets set`:
//   APPLE_TEAM_ID     the 10-character team id
//   APPLE_KEY_ID      the 10-character key id of the .p8
//   APPLE_CLIENT_ID   the app's bundle id (the Services ID is for the web)
//   APPLE_PRIVATE_KEY the .p8 contents, PEM, newlines or literal \n both fine

const APPLE = 'https://appleid.apple.com';

export type AppleConfig = {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKey: string;
};

/** Null until the founder has provisioned the key. Never throws. */
export function appleConfig(): AppleConfig | null {
  const teamId = Deno.env.get('APPLE_TEAM_ID') ?? '';
  const keyId = Deno.env.get('APPLE_KEY_ID') ?? '';
  const clientId = Deno.env.get('APPLE_CLIENT_ID') ?? '';
  const privateKey = Deno.env.get('APPLE_PRIVATE_KEY') ?? '';
  if (!teamId || !keyId || !clientId || !privateKey) {
    return null;
  }
  return { teamId, keyId, clientId, privateKey };
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlText(text: string): string {
  return base64url(new TextEncoder().encode(text));
}

/**
 * PEM to the DER bytes crypto.subtle wants.
 *
 * The secret arrives through an environment variable, and a shell that pastes
 * a .p8 through one usually turns its newlines into a literal backslash-n.
 * Accept both spellings: a key that "looks set" and cannot be parsed is the
 * worst version of this failure.
 */
// `Uint8Array<ArrayBuffer>`, not the bare `Uint8Array` this used to say. The
// bare name widened to `Uint8Array<ArrayBufferLike>` in the TypeScript lib
// Deno 2.x now ships, and `ArrayBufferLike` includes SharedArrayBuffer, which
// `crypto.subtle.importKey` will not take. The bytes were always a plain
// ArrayBuffer — `new Uint8Array(n)` allocates one — so this narrows the
// annotation to what the function already returns and adds no runtime code.
function pkcs8Bytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

/**
 * The client secret Apple asks for: a short-lived ES256 JWT signed with the
 * .p8. Apple caps the lifetime at six months; ten minutes is all either
 * caller needs, and a secret that expires before it can be logged is one
 * fewer credential in a log file.
 *
 * WebCrypto's ECDSA signature is already the raw r||s pair JWS wants, so
 * there is no DER unwrapping step here and there should never be one.
 */
export async function appleClientSecret(config: AppleConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const payload = {
    iss: config.teamId,
    iat: now,
    exp: now + 600,
    aud: APPLE,
    sub: config.clientId,
  };
  const signingInput = `${base64urlText(JSON.stringify(header))}.${base64urlText(
    JSON.stringify(payload)
  )}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Bytes(config.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

export type AppleCallResult = { ok: boolean; status: number; detail: string };

async function postForm(path: string, form: URLSearchParams): Promise<Response> {
  return await fetch(`${APPLE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

/**
 * Spend the authorization code Apple hands the app at sign-in, once, for the
 * refresh token that can later revoke the whole grant. The code is good for
 * five minutes and for exactly one exchange, which is why the token has to be
 * kept rather than re-derived at deletion time.
 */
export async function exchangeAuthorizationCode(
  config: AppleConfig,
  code: string
): Promise<{ refreshToken: string | null } & AppleCallResult> {
  const secret = await appleClientSecret(config);
  const response = await postForm(
    '/auth/token',
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
    })
  );
  const text = await response.text();
  if (!response.ok) {
    return { refreshToken: null, ok: false, status: response.status, detail: text.slice(0, 300) };
  }
  let refreshToken: string | null = null;
  try {
    refreshToken = (JSON.parse(text) as { refresh_token?: string }).refresh_token ?? null;
  } catch {
    refreshToken = null;
  }
  return {
    refreshToken,
    ok: refreshToken != null,
    status: response.status,
    detail: refreshToken == null ? 'no refresh_token in Apple response' : 'ok',
  };
}

/**
 * Tell Apple to forget the grant. Called from delete-account and allowed to
 * fail: a revoke that does not land is a listing left standing under iOS
 * Settings, and a deletion that does not happen is somebody's right refused.
 * The caller logs the result; it never blocks.
 */
export async function revokeRefreshToken(
  config: AppleConfig,
  refreshToken: string
): Promise<AppleCallResult> {
  const secret = await appleClientSecret(config);
  const response = await postForm(
    '/auth/revoke',
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: secret,
      token: refreshToken,
      token_type_hint: 'refresh_token',
    })
  );
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    detail: response.ok ? 'ok' : text.slice(0, 300),
  };
}
