// Provisions iOS signing credentials through the App Store Connect API.
//
// Exists because eas-cli cannot create a distribution certificate in
// non-interactive mode — its runNonInteractiveAsync is literally a TODO that
// only reuses a cert already stored on Expo's servers, and this project has
// no interactive machine to seed one from. So the workflow does what
// fastlane's cert+sigh do: mint the certificate and App Store profile via
// Apple's API and hand them to EAS as local credentials (credentials.json).
//
// STATELESS BY DESIGN: every run revokes existing iOS distribution
// certificates and deletes this pipeline's old profiles, then creates fresh
// ones. That is safe while this workflow is the only thing signing for the
// team. If a Mac/Xcode ever joins this project, replace the revoke-all with
// key reuse before it tramples that machine's certificate.
//
// Env in:  ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH, BUNDLE_ID, APP_NAME,
//          CSR_PATH (PEM)
// Files out: CERT_DER_OUT (DER), PROFILE_OUT (.mobileprovision)

import fs from 'node:fs';
import { createRequire } from 'node:module';
const jwt = createRequire(import.meta.url)('jsonwebtoken');

const API = 'https://api.appstoreconnect.apple.com/v1';
const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`::error::${name} is not set`);
    process.exit(1);
  }
  return v;
};

const issuerId = need('ASC_ISSUER_ID');
const keyId = need('ASC_KEY_ID');
const key = fs.readFileSync(need('ASC_KEY_PATH'), 'utf8');
const bundleId = need('BUNDLE_ID');
const appName = need('APP_NAME');
const csrPem = fs.readFileSync(need('CSR_PATH'), 'utf8');

const token = () =>
  jwt.sign({ iss: issuerId, aud: 'appstoreconnect-v1' }, key, {
    algorithm: 'ES256',
    expiresIn: '15m',
    keyid: keyId,
  });

async function asc(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const detail =
      json?.errors?.map((e) => `${e.status} ${e.code}: ${e.title} — ${e.detail}`).join('; ') ??
      text.slice(0, 500);
    throw new Error(`${method} ${path} → ${detail}`);
  }
  return json;
}

// 1. Bundle id: find or register.
let bid = (await asc('GET', `/bundleIds?filter[identifier]=${bundleId}&limit=200`)).data.find(
  (d) => d.attributes.identifier === bundleId
);
if (bid) {
  console.log(`bundle id ${bundleId} already registered (${bid.id})`);
} else {
  bid = (
    await asc('POST', '/bundleIds', {
      data: {
        type: 'bundleIds',
        attributes: { identifier: bundleId, name: appName, platform: 'IOS' },
      },
    })
  ).data;
  console.log(`registered bundle id ${bundleId} (${bid.id})`);
}

// 2. Capabilities the app's entitlements need: aps-environment (from
// expo-notifications) and Sign in with Apple (usesAppleSignIn). A profile
// minted without them fails at signing, not here.
const have = new Set(
  (// This relationship endpoint rejects paging params (400 PARAMETER_ERROR.ILLEGAL).
  await asc('GET', `/bundleIds/${bid.id}/bundleIdCapabilities`)).data.map(
    (c) => c.attributes.capabilityType
  )
);
const wanted = [
  { capabilityType: 'PUSH_NOTIFICATIONS' },
  {
    capabilityType: 'APPLE_ID_AUTH',
    settings: [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT' }] }],
  },
];
for (const cap of wanted) {
  if (have.has(cap.capabilityType)) {
    console.log(`capability ${cap.capabilityType} already enabled`);
    continue;
  }
  await asc('POST', '/bundleIdCapabilities', {
    data: {
      type: 'bundleIdCapabilities',
      attributes: cap,
      relationships: { bundleId: { data: { type: 'bundleIds', id: bid.id } } },
    },
  });
  console.log(`enabled capability ${cap.capabilityType}`);
}

// 3. Certificate: revoke-all-then-create (see header).
const oldCerts = (
  await asc('GET', '/certificates?filter[certificateType]=IOS_DISTRIBUTION&limit=200')
).data;
for (const c of oldCerts) {
  await asc('DELETE', `/certificates/${c.id}`);
  console.log(`revoked old distribution certificate ${c.attributes.serialNumber}`);
}
const cert = (
  await asc('POST', '/certificates', {
    data: {
      type: 'certificates',
      attributes: { certificateType: 'IOS_DISTRIBUTION', csrContent: csrPem },
    },
  })
).data;
fs.writeFileSync(need('CERT_DER_OUT'), Buffer.from(cert.attributes.certificateContent, 'base64'));
console.log(`created distribution certificate ${cert.attributes.serialNumber}`);

// 4. Profile: drop this pipeline's stale ones, mint a fresh App Store profile.
const PROFILE_PREFIX = `${appName} CI`;
const oldProfiles = (await asc('GET', '/profiles?filter[profileType]=IOS_APP_STORE&limit=200'))
  .data;
for (const p of oldProfiles) {
  if (p.attributes.name.startsWith(PROFILE_PREFIX)) {
    await asc('DELETE', `/profiles/${p.id}`);
    console.log(`deleted stale profile "${p.attributes.name}"`);
  }
}
const profile = (
  await asc('POST', '/profiles', {
    data: {
      type: 'profiles',
      attributes: {
        name: `${PROFILE_PREFIX} ${new Date().toISOString().replace(/[:.]/g, '-')}`,
        profileType: 'IOS_APP_STORE',
      },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bid.id } },
        certificates: { data: [{ type: 'certificates', id: cert.id }] },
      },
    },
  })
).data;
fs.writeFileSync(need('PROFILE_OUT'), Buffer.from(profile.attributes.profileContent, 'base64'));
console.log(`created provisioning profile "${profile.attributes.name}"`);
