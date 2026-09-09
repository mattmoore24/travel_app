// Runs the real `harden-project-settings.mjs` against a fake Supabase project.
//
// The script it exercises will be pointed at production with a token that can
// change anything about the project, and it has no unit seam: it is top-level
// await, it reads env, and it ends in `process.exit`. So the test drives it the
// way the workflow does — as a whole program — with `fetch` replaced by a
// mutable document store and the outcome read off stdout and the exit code.
// `a-dashboard-setting-in-code.test.ts` spawns this file once per scenario.
//
// Not a workflow step and not shipped to a device. It exists so that the
// decisions in that script — narrow but never widen, refuse a list without
// `public`, notice a PATCH that replaces the document, write nothing in check
// mode — are things somebody has watched happen rather than things somebody
// has read.
//
// Usage: node <this> <scenario>   where scenario is one of
//   dirty     everything wrong: net and storage exposed, HIBP off, anonymous
//             sign-ins never set, a 50 MB storage ceiling
//   clean     everything already right, so every section should no-op
//   nopublic  db_schema without `public`, which the script must refuse
//   replace   a PATCH that REPLACES the document instead of merging
//   tight     already stricter than this script would set: a 1 MB storage
//             ceiling, which it must leave alone rather than raise
// MODE picks apply (default) or check, exactly as the workflow's env does.

const scenario = process.argv[2] ?? 'dirty';

const postgrest = {
  dirty: 'public, graphql_public, net, storage',
  clean: 'public, graphql_public',
  nopublic: 'net, storage',
  replace: 'public, net',
  tight: 'public, graphql_public',
}[scenario];

if (postgrest === undefined) {
  console.error(`unknown scenario ${scenario}`);
  process.exit(2);
}

const settled = scenario === 'clean' || scenario === 'replace' || scenario === 'tight';

const state = {
  '/postgrest': {
    db_schema: postgrest,
    max_rows: 1000,
    db_extra_search_path: 'public, extensions',
    db_pool: null,
    db_pool_acquisition_timeout: 10,
  },
  '/config/auth': {
    password_hibp_enabled: settled ? true : false,
    external_anonymous_users_enabled: settled ? false : null,
    // Two of the twenty-odd secrets the real GET carries. The test asserts
    // these strings never reach stdout.
    sms_twilio_auth_token: 'twilio-secret-must-not-print',
    security_captcha_secret: 'captcha-secret-must-not-print',
  },
  '/config/storage': {
    fileSizeLimit: scenario === 'tight' ? 1024 * 1024 : settled ? 5 * 1024 * 1024 : 52428800,
    features: { imageTransformation: { enabled: false } },
  },
};

globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace('https://api.supabase.com/v1/projects/testref', '');
  if (!(path in state)) {
    return new Response(JSON.stringify({ message: `no such path ${path}` }), { status: 404 });
  }
  if ((init.method ?? 'GET') === 'PATCH') {
    const body = JSON.parse(init.body);
    if (scenario === 'replace') {
      state[path] = body;
    } else {
      Object.assign(state[path], body);
    }
  }
  return new Response(JSON.stringify(state[path]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

process.env.SUPABASE_ACCESS_TOKEN = 'stub';
process.env.PROJECT_REF = 'testref';
process.env.MODE = process.env.MODE ?? 'apply';
delete process.env.GITHUB_STEP_SUMMARY;

process.on('exit', () => {
  // The state the fake project ended in, for the test to assert against — a
  // read-back of the script's read-back.
  console.log(`ENDED db_schema=${state['/postgrest'].db_schema}`);
  console.log(`ENDED max_rows=${state['/postgrest'].max_rows}`);
  console.log(`ENDED hibp=${state['/config/auth'].password_hibp_enabled}`);
  console.log(`ENDED anonymous=${state['/config/auth'].external_anonymous_users_enabled}`);
  console.log(`ENDED fileSizeLimit=${state['/config/storage'].fileSizeLimit}`);
});

await import('../harden-project-settings.mjs');
