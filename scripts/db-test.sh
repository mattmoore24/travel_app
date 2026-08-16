#!/usr/bin/env bash
# Run the database migrations + pgTAP RLS test suite against a throwaway local
# Postgres cluster. Self-contained: creates the cluster, applies the Supabase
# shim (supabase/shim/), applies every migration in order, runs pg_prove, and
# tears everything down. Used locally and by CI (see .github/workflows/ci.yml).
#
# Requirements: postgresql server binaries (16+), pgtap, pg_prove.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
  echo "error: postgres server binaries not found (set PG_BIN)" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
PGDATA="$WORKDIR/data"
export PGHOST="$WORKDIR"
export PGPORT="${DB_TEST_PORT:-54329}"
export PGUSER=postgres
DB=app_test

cleanup() {
  "$AS_PG" "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" || true
}
trap cleanup EXIT

# Postgres refuses to run as root (e.g. in a root container); rerun its
# commands as the postgres system user in that case.
if [[ "$(id -u)" == "0" ]]; then
  chown -R postgres:postgres "$WORKDIR"
  AS_PG() { su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; }
  AS_PG=AS_PG
else
  AS_PG() { "$@"; }
  AS_PG=AS_PG
fi

AS_PG "$PG_BIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
AS_PG "$PG_BIN/pg_ctl" -D "$PGDATA" \
  -o "-k $WORKDIR -p $PGPORT -c listen_addresses=''" \
  -l "$WORKDIR/pg.log" start >/dev/null

"$PG_BIN/createdb" "$DB"

echo "==> applying supabase shim"
"$PG_BIN/psql" -q -v ON_ERROR_STOP=1 -d "$DB" \
  -f "$REPO_ROOT/supabase/shim/local_supabase_shim.sql"

echo "==> applying migrations"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  "$PG_BIN/psql" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done

echo "==> running pgTAP suite"
pg_prove --psql-bin "$PG_BIN/psql" -d "$DB" "$REPO_ROOT"/supabase/tests/database/*.test.sql
