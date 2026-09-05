// Attaches an APNs auth key to this project's EAS credentials through Expo's
// GraphQL API — the same calls eas-cli makes, in the same order.
//
// Every mutation name, input shape and argument below was read out of
// eas-cli's own compiled source (build/credentials/ios/api/graphql/) rather
// than recalled, because an undocumented API guessed at is a way to spend an
// afternoon discovering that a field is called something else.
//
// NOTHING HERE DELETES OR REVOKES. Reads, creates and one set. That is
// deliberate: the interactive flow this replaces can revoke a key by accident
// (its "generate a new key?" prompt defaults to Yes, and at Apple's two-key
// cap it then offers to revoke), and a revoked key takes push down for
// whatever was using it.

const API = 'https://api.expo.dev/graphql';
const TOKEN = process.env.EXPO_TOKEN;
const KEY_ID = (process.env.KEY_ID ?? '').trim();
const TEAM_ID = (process.env.TEAM_ID ?? '').trim();
const DRY_RUN = process.env.DRY_RUN === 'true';

// The account and bundle id are facts about this project, not inputs: a typo
// in either would create a second, wrong record rather than fail.
const ACCOUNT_NAME = 'mattmoore24s-team';
const BUNDLE_ID = 'com.mattmoore.samewhere';
const PROJECT_ID = '4e5da662-4b34-482a-bc54-8578d237bf54';

if (!/^[A-Z0-9]{10}$/.test(KEY_ID)) {
  fail(
    `Key ID "${KEY_ID}" is not 10 uppercase alphanumerics. Copy it from Apple Developer -> Keys.`
  );
}
if (!/^[A-Z0-9]{10}$/.test(TEAM_ID)) {
  fail(`Team ID "${TEAM_ID}" is not 10 uppercase alphanumerics.`);
}

// The .p8 is a private key. It is passed to Expo and never printed: no echo,
// no error message that quotes it, no summary line.
const P8 = process.env.APPLE_PUSH_KEY_P8 ?? '';
if (!DRY_RUN && !P8.includes('BEGIN PRIVATE KEY')) {
  fail(
    'APPLE_PUSH_KEY_P8 does not look like a .p8 file. It must hold the FULL text of ' +
      'AuthKey_XXXXXXXXXX.p8, including the BEGIN and END lines.'
  );
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

async function gql(query, variables) {
  const response = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors) {
    const detail = body.errors ? body.errors.map((e) => e.message).join('; ') : response.status;
    fail(`Expo API: ${detail}`);
  }
  return body.data;
}

// --- 1. The account ---------------------------------------------------------
const account = (
  await gql(
    `query AccountByName($accountName: String!) {
       account { byName(accountName: $accountName) { id name } }
     }`,
    { accountName: ACCOUNT_NAME }
  )
).account.byName;
console.log(`Account ${account.name} (${account.id})`);

// --- 2. What is already there ----------------------------------------------
// Read before writing, so a re-run reports rather than duplicates.
const existingKeys = (
  await gql(
    `query PushKeys($accountName: String!) {
       account {
         byName(accountName: $accountName) {
           id
           applePushKeys { id keyIdentifier appleTeam { appleTeamIdentifier } }
           appleTeams { id appleTeamIdentifier }
         }
       }
     }`,
    { accountName: ACCOUNT_NAME }
  )
).account.byName;

console.log(
  `Apple teams on the account: ${
    existingKeys.appleTeams.map((t) => t.appleTeamIdentifier).join(', ') ||
    '(none — this is the blocker)'
  }`
);
console.log(
  `Push keys on the account: ${
    existingKeys.applePushKeys.map((k) => k.keyIdentifier).join(', ') || '(none)'
  }`
);

if (DRY_RUN) {
  console.log('Dry run: nothing was changed.');
  process.exit(0);
}

// --- 3. The Apple Team, which is the record that does not exist -------------
let team = existingKeys.appleTeams.find((t) => t.appleTeamIdentifier === TEAM_ID);
if (team) {
  console.log(`Apple team ${TEAM_ID} already registered (${team.id}).`);
} else {
  team = (
    await gql(
      `mutation CreateAppleTeam($appleTeamInput: AppleTeamInput!, $accountId: ID!) {
         appleTeam {
           createAppleTeam(appleTeamInput: $appleTeamInput, accountId: $accountId) {
             id appleTeamIdentifier
           }
         }
       }`,
      { appleTeamInput: { appleTeamIdentifier: TEAM_ID }, accountId: account.id }
    )
  ).appleTeam.createAppleTeam;
  console.log(`Created Apple team ${TEAM_ID} (${team.id}). This is what the website could not do.`);
}

// --- 4. The bundle id -------------------------------------------------------
const appleAppIdentifier = (
  await gql(
    `mutation CreateAppleAppIdentifier($appleAppIdentifierInput: AppleAppIdentifierInput!, $accountId: ID!) {
       appleAppIdentifier {
         createAppleAppIdentifier(appleAppIdentifierInput: $appleAppIdentifierInput, accountId: $accountId) {
           id bundleIdentifier
         }
       }
     }`,
    {
      appleAppIdentifierInput: { bundleIdentifier: BUNDLE_ID, appleTeamId: team.id },
      accountId: account.id,
    }
  )
).appleAppIdentifier.createAppleAppIdentifier;
console.log(`Bundle id ${appleAppIdentifier.bundleIdentifier} (${appleAppIdentifier.id})`);

// --- 5. The push key --------------------------------------------------------
const already = existingKeys.applePushKeys.find((k) => k.keyIdentifier === KEY_ID);
let pushKey;
if (already) {
  pushKey = already;
  console.log(`Push key ${KEY_ID} is already on the account (${already.id}); reusing it.`);
} else {
  pushKey = (
    await gql(
      `mutation CreateApplePushKey($applePushKeyInput: ApplePushKeyInput!, $accountId: ID!) {
         applePushKey {
           createApplePushKey(applePushKeyInput: $applePushKeyInput, accountId: $accountId) {
             id keyIdentifier
           }
         }
       }`,
      {
        applePushKeyInput: { appleTeamId: team.id, keyIdentifier: KEY_ID, keyP8: P8 },
        accountId: account.id,
      }
    )
  ).applePushKey.createApplePushKey;
  console.log(`Stored push key ${KEY_ID} (${pushKey.id}).`);
}

// --- 6. Attach it to the app ------------------------------------------------
// Query BEFORE creating. createIosAppCredentials is NOT create-or-return - an
// earlier version of this file assumed it was, and the second run died on
// "Credential for Apple application identifier already exists for this app".
// Which was useful: a mutation that throws on the happy path of a re-run makes
// the script single-use, and a credentials script you can only run once is one
// you cannot use to check anything.
const APP_CREDENTIALS_QUERY = `
  query AppPushKey($projectFullName: String!, $appleAppIdentifierId: String!) {
    app {
      byFullName(fullName: $projectFullName) {
        id
        iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
          id
          pushKey { id keyIdentifier }
          appleTeam { appleTeamIdentifier }
        }
      }
    }
  }`;
const APP_VARS = {
  projectFullName: `@${ACCOUNT_NAME}/samewhere`,
  appleAppIdentifierId: appleAppIdentifier.id,
};

const existingCredentials = (await gql(APP_CREDENTIALS_QUERY, APP_VARS)).app.byFullName
  .iosAppCredentials;

let credentials = existingCredentials[0];
if (credentials) {
  console.log(
    `App credentials row already exists (${credentials.id}), push key on it: ` +
      `${credentials.pushKey?.keyIdentifier ?? '(none)'}`
  );
} else {
  credentials = (
    await gql(
      `mutation CreateIosAppCredentials(
       $iosAppCredentialsInput: IosAppCredentialsInput!
       $appId: ID!
       $appleAppIdentifierId: ID!
     ) {
       iosAppCredentials {
         createIosAppCredentials(
           iosAppCredentialsInput: $iosAppCredentialsInput
           appId: $appId
           appleAppIdentifierId: $appleAppIdentifierId
         ) { id }
       }
     }`,
      {
        iosAppCredentialsInput: { appleTeamId: team.id },
        appId: PROJECT_ID,
        appleAppIdentifierId: appleAppIdentifier.id,
      }
    )
  ).iosAppCredentials.createIosAppCredentials;
  console.log(`Created the app credentials row (${credentials.id}).`);
}

await gql(
  `mutation SetPushKey($iosAppCredentialsId: ID!, $pushKeyId: ID!) {
     iosAppCredentials { setPushKey(id: $iosAppCredentialsId, pushKeyId: $pushKeyId) { id } }
   }`,
  { iosAppCredentialsId: credentials.id, pushKeyId: pushKey.id }
);
console.log(`Push key ${KEY_ID} attached to ${BUNDLE_ID}.`);

// --- 7. Read it back, because a mutation answering 200 is not proof ---------
const after = (
  await gql(
    `query PushKeys($accountName: String!) {
       account {
         byName(accountName: $accountName) {
           id
           appleTeams { appleTeamIdentifier }
           applePushKeys { keyIdentifier }
         }
       }
     }`,
    { accountName: ACCOUNT_NAME }
  )
).account.byName;

const teamThere = after.appleTeams.some((t) => t.appleTeamIdentifier === TEAM_ID);
const keyThere = after.applePushKeys.some((k) => k.keyIdentifier === KEY_ID);
if (!teamThere || !keyThere) {
  fail(
    `Read-back failed: team ${TEAM_ID} ${teamThere ? 'present' : 'MISSING'}, ` +
      `key ${KEY_ID} ${keyThere ? 'present' : 'MISSING'}.`
  );
}

// AND THAT IT IS ATTACHED TO THE APP, which is a different question and the
// one that decides whether a push is delivered. The first version of this
// script checked only the two above and reported "team and key are both
// present", which was true and not enough: a key can sit on the account while
// the app's credentials have none, and Expo then answers a send with "you
// need to upload push notification credentials". Ask the app.
const appCredentials = (await gql(APP_CREDENTIALS_QUERY, APP_VARS)).app.byFullName
  .iosAppCredentials;

const attached = appCredentials.find((c) => c.pushKey?.keyIdentifier === KEY_ID);
console.log(
  `App credentials rows: ${appCredentials.length}; push keys on them: ${
    appCredentials.map((c) => c.pushKey?.keyIdentifier ?? '(none)').join(', ') || '(no rows)'
  }`
);
if (!attached) {
  fail(
    `Push key ${KEY_ID} is on the account but NOT attached to the app's iOS credentials. ` +
      'Expo will refuse to send. This is the state that produces "you need to upload push ' +
      'notification credentials" on expo.dev/notifications.'
  );
}

const summary = [
  '## APNs push key attached',
  '',
  `- Apple team: \`${TEAM_ID}\``,
  `- Push key: \`${KEY_ID}\``,
  `- Bundle id: \`${BUNDLE_ID}\``,
  '',
  'Next: install build 17, accept the push prompt, read your token out of',
  '`push_tokens`, and send one from https://expo.dev/notifications.',
  '',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
console.log('Verified against the API: team and key are both present.');
