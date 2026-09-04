// Reads the live project's Edge Function console output and answers ONE
// question: did Sign in with Apple's token revocation actually run?
//
// WHY THIS EXISTS. Nothing else can answer it. `delete-account` returns
// `{ deleted: true }` down every branch of its revoke block, so the app looks
// identical whether Apple was told to forget the account or the whole step was
// skipped; `store-apple-token` logs nothing at all on success and answers 200
// on three different soft failures. The one artifact that separates them is a
// console line inside the function, and the founder has no machine to read it
// from — the same fact scripts/asc-provision.mjs and .github/scripts/
// attach-push-key.mjs exist for.
//
// THE REDACTION CONTRACT, and it is most of this file. This repository is
// PUBLIC (docs/PROGRESS.md; docs/LAUNCH_RUNBOOK.md §5 is the gate that flips
// it), so an Actions log is a permanent world-readable document, and a
// production log line can carry a first message, a social handle, a pin's
// venue or a bearer token — §7 rules 2, 3, 4, 5 and 6 all land on this file.
// So this is an ALLOWLIST and never a denylist:
//   * The SQL matches only lines beginning `apple revoke:` or
//     `store-apple-token:`. No other row is ever fetched into this runner,
//     which is stronger than fetching it and choosing not to print it.
//   * A fetched line is CLASSIFIED against the exact shapes those two
//     functions can emit, and what prints is the classification — a name this
//     file already contains — not the line.
//   * The two diagnostic branches interpolate a detail (Apple's error body, a
//     Postgres message, a thrown error). That detail is scrubbed of anything
//     shaped like a uuid, an email, a JWT or a long token, then capped.
//   * A matching line whose shape this file does not recognise prints as
//     `(unrecognised shape, withheld)` plus a sha256 bucket, so a future log
//     string cannot print itself by accident. That is the whole point of an
//     allowlist.
// If a question cannot be answered inside this contract, the answer is not to
// widen it.
//
// READ-ONLY BY CONSTRUCTION: two GETs. There is no POST, PATCH, PUT or DELETE
// anywhere in this file, so it cannot change the project.
//
// FIELD NAMES were read off the published OpenAPI spec (supabase/supabase,
// apps/docs/spec/transforms/api_v1_openapi_deparsed.json, paths
// `/v1/projects/{ref}/analytics/endpoints/logs` and
// `/v1/projects/{ref}/functions/{function_slug}`) rather than recalled, the
// way .github/scripts/enable-apple-provider.mjs reads its own. Two things that
// cost a run each if guessed: `analytics/endpoints/logs.all` is marked
// deprecated and defaults to the older engine, and a failed query arrives as
// HTTP 200 with a populated `error`, so `error` is checked before `result`.

import { classify, scrub } from './apple-log-shapes.mjs';

const API = 'https://api.supabase.com';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const PROJECT_REF = (process.env.PROJECT_REF ?? '').trim();
const MINUTES = Number.parseInt((process.env.LOOKBACK_MINUTES ?? '1439').trim(), 10);

// The window is rounded to the nearest minute server side and a span of more
// than 24 hours is not honoured, so the default sits a minute under the
// boundary rather than on it.
const MAX_MINUTES = 1439;
const MAX_ROWS = 200;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!TOKEN) {
  fail('SUPABASE_ACCESS_TOKEN is empty. Add it under Settings then Secrets and variables.');
}
// A project ref is exactly twenty lowercase letters. Checking the shape here
// turns a typo into a sentence instead of a 404 from an endpoint nobody has
// looked at before.
if (!/^[a-z]{20}$/.test(PROJECT_REF)) {
  fail('SUPABASE_PROJECT_REF is not a project ref (twenty lowercase letters).');
}
if (!Number.isInteger(MINUTES) || MINUTES < 1 || MINUTES > MAX_MINUTES) {
  fail(`LOOKBACK_MINUTES must be a whole number of minutes, 1 to ${MAX_MINUTES}.`);
}

/** GET, with the four documented failures spelled out rather than lumped together. */
async function get(url, what) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    // An error body is not a place to relax the contract above: the API's own
    // `message` and nothing else.
    const detail =
      parsed && typeof parsed.message === 'string' ? parsed.message : '(body withheld)';
    if (response.status === 401 || response.status === 403) {
      fail(
        `${what}: ${response.status} ${detail}. SUPABASE_ACCESS_TOKEN has expired, or it does ` +
          `not belong to the account that owns ${PROJECT_REF}. Personal access tokens are ` +
          'time-limited: https://supabase.com/dashboard/account/tokens'
      );
    }
    if (response.status === 402) {
      fail(
        `${what}: 402 ${detail}. This is a billing state, not a bad token — the project has ` +
          'used its log-query allowance. Nothing is wrong with the secrets.'
      );
    }
    if (response.status === 429) {
      fail(`${what}: 429 ${detail}. Log queries are rate limited; wait a minute and re-run.`);
    }
    fail(`${what}: ${response.status} ${detail}`);
  }
  if (parsed === null) {
    fail(`${what}: the response was not JSON.`);
  }
  return parsed;
}

/**
 * Run one log query.
 *
 * Returns rows, or the API's own error string. A failed query comes back as
 * HTTP 200 with a populated `error`, so reading `result` first would report
 * success on a failure — hence the two-value return rather than a throw.
 */
async function queryLogs(sql, startISO, endISO) {
  const url = new URL(`${API}/v1/projects/${PROJECT_REF}/analytics/endpoints/logs`);
  url.searchParams.set('sql', sql);
  url.searchParams.set('iso_timestamp_start', startISO);
  url.searchParams.set('iso_timestamp_end', endISO);
  const body = await get(url, 'Supabase logs');
  if (body.error) {
    const detail = typeof body.error === 'string' ? body.error : (body.error.message ?? 'unknown');
    return { rows: null, error: detail };
  }
  return { rows: body.result ?? [], error: null };
}

// --- 1. Which functions to ask about ----------------------------------------
//
// The log rows carry a function id and no name, so the slug has to be resolved
// first. This is also a useful liveness check in its own right: it proves the
// function is deployed at all.

console.log(`Project ${PROJECT_REF}, looking back ${MINUTES} minutes.`);

const FUNCTIONS = ['delete-account', 'store-apple-token'];
const ids = {};
for (const slug of FUNCTIONS) {
  const fn = await get(`${API}/v1/projects/${PROJECT_REF}/functions/${slug}`, `function ${slug}`);
  if (!fn.id) {
    fail(`function ${slug}: the API returned no id.`);
  }
  ids[slug] = fn.id;
  console.log(`  ${slug}: version ${fn.version}, status ${fn.status}, updated ${fn.updated_at}`);
}

// --- 2. The window ----------------------------------------------------------

const end = new Date();
const start = new Date(end.getTime() - MINUTES * 60_000);
const endISO = `${end.toISOString().slice(0, 19)}Z`;
const startISO = `${start.toISOString().slice(0, 19)}Z`;
console.log(`\nWindow: ${startISO} to ${endISO}`);

// --- 3. The query -----------------------------------------------------------
//
// Two dialects. ClickHouse is the current engine and puts every line in one
// `logs` table tagged by `source`; a project old enough to still be on the
// previous engine needs the table-per-source form with its unnest. Rather than
// guess which one this project is on, try the current one and fall back — and
// say which answered, because that is a fact about the project worth knowing.

const idList = FUNCTIONS.map((slug) => `'${ids[slug]}'`).join(', ');
// `like '%...%'` rather than a prefix, because whether `event_message` is the
// bare console line or something the platform wrapped around it is not worth a
// run to discover. appleLine() trims whatever is in front of the marker.
const MARKERS =
  "(event_message like '%apple revoke:%' or event_message like '%store-apple-token:%')";

const clickhouse = `select timestamp, event_message, log_attributes['function_id'] as function_id
  from logs
  where source = 'function_logs'
    and log_attributes['function_id'] in (${idList})
    and ${MARKERS}
  order by timestamp desc
  limit ${MAX_ROWS}`;

const bigquery = `select function_logs.timestamp, event_message, metadata.function_id as function_id
  from function_logs
  cross join unnest(metadata) as metadata
  where metadata.function_id in (${idList})
    and ${MARKERS}
  order by timestamp desc
  limit ${MAX_ROWS}`;

let { rows, error } = await queryLogs(clickhouse, startISO, endISO);
let dialect = 'ClickHouse';
if (error) {
  console.log(`\nThe ClickHouse form was refused (${scrub(error)}); trying the older engine.`);
  ({ rows, error } = await queryLogs(bigquery, startISO, endISO));
  dialect = 'BigQuery';
}
if (error) {
  fail(`Neither log dialect was accepted. The API said: ${scrub(error)}`);
}
console.log(`Answered by the ${dialect} engine: ${rows.length} matching line(s).`);

// How many lines those two functions wrote in total, Apple or not. A pure
// count carries no user content, and it is what turns "no Apple lines" from
// an ambiguous answer into a diagnosable one: with a healthy total, nobody
// deleted an account in the window; with a total of zero, the window is wrong
// or the retention period has already dropped them.
const totalSql =
  dialect === 'ClickHouse'
    ? `select count() as lines from logs
       where source = 'function_logs' and log_attributes['function_id'] in (${idList})`
    : `select count(1) as lines from function_logs
       cross join unnest(metadata) as metadata
       where metadata.function_id in (${idList})`;
const total = await queryLogs(totalSql, startISO, endISO);
if (total.error) {
  console.log(`(Could not count the window's lines: ${scrub(total.error)})`);
} else {
  const counted = total.rows?.[0]?.lines ?? 0;
  console.log(`Those two functions wrote ${counted} line(s) in total in this window.`);
}

// --- 4. What the lines say --------------------------------------------------

const byId = Object.fromEntries(FUNCTIONS.map((slug) => [ids[slug], slug]));
const seen = rows
  .map((row) => ({
    at: String(row.timestamp ?? ''),
    fn: byId[String(row.function_id ?? '')] ?? '(unknown function)',
    ...classify(String(row.event_message ?? '')),
  }))
  .sort((a, b) => a.at.localeCompare(b.at));

const lines = [];
if (seen.length === 0) {
  lines.push(
    'No Apple lines in the window. That is not a pass and not a failure: it is ' +
      'the same answer for "no deletion happened", "the window is too short", and ' +
      '"the retention period already dropped them".'
  );
} else {
  for (const row of seen) {
    lines.push(`${row.at}  [${row.verdict}]  ${row.name}\n      ${row.detail}`);
  }
}
console.log(`\n${lines.join('\n')}`);

// --- 5. The verdict, stated with its limits ---------------------------------

const passes = seen.filter((row) => row.verdict === 'pass').length;
const failures = seen.filter((row) => row.verdict === 'fail');
const quiet = seen.filter((row) => row.verdict === 'quiet').length;

const verdict = [];
if (failures.length > 0) {
  verdict.push(
    `${failures.length} line(s) say the revoke did not happen. This is the blocking case: ` +
      'App Review 5.1.1(v) requires the call, and it is not being made.'
  );
} else if (passes > 0) {
  verdict.push(
    `${passes} deletion(s) reached Apple and Apple agreed.`,
    '',
    'What that proves, exactly: delete-account found a stored refresh token, signed a ' +
      'client secret with the .p8 that Apple accepted as belonging to this app, and posted ' +
      'a revoke that Apple answered 2xx. All four APPLE_* secrets are therefore correct and ' +
      'the whole path is wired.',
    'What it does not prove: Apple answers 200 both for "revoked" and for "that token was ' +
      'already invalid", so a single ok() line is not by itself proof that a live grant was ' +
      'withdrawn at that moment. Paired with a sign-in whose token was stored minutes ' +
      'earlier, it is.'
  );
} else if (quiet > 0) {
  verdict.push(
    'Every line is a quiet one. Most likely all of them say "no token for this account", ' +
      'which is what a deletion looks like when the sign-in never stored a token — the ' +
      'false pass docs/APP_STORE.md warns about. Sign out, sign in with Apple again, and ' +
      'delete that account.'
  );
}

if (verdict.length > 0) {
  console.log(`\n${verdict.join('\n')}`);
}

// --- 6. Step summary --------------------------------------------------------

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  const summary = [
    '## Sign in with Apple: did the revoke run?',
    '',
    `Window: \`${startISO}\` to \`${endISO}\` (${MINUTES} minutes), ${dialect} engine.`,
    '',
    seen.length === 0 ? '_No Apple lines in the window._' : '```\n' + lines.join('\n') + '\n```',
    '',
    ...verdict,
    '',
    '<sub>Lines are classified against the exact strings `delete-account` and ' +
      '`store-apple-token` can emit; the classification is printed, never the raw log row. ' +
      'See the header of `.github/scripts/read-apple-revoke-log.mjs`.</sub>',
    '',
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

// A run that found nothing is not a failing run — the founder asked a
// question and "no lines in this window" is an answer. Only a definite
// failure line makes this red, because that one is a launch blocker.
if (failures.length > 0) {
  process.exit(1);
}
