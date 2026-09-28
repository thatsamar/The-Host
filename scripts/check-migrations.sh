#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway local Postgres (with pgvector) using
# minimal stand-ins for Supabase's auth and storage schemas, then runs RLS checks.
# Requires: postgresql-16 + postgresql-16-pgvector installed locally.
# Usage: bash scripts/check-migrations.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DIR="$(mktemp -d)"
PORT="${PGPORT_CHECK:-55432}"
cleanup() { "$PGBIN/pg_ctl" -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

RUNAS=()
if [ "$(id -u)" = "0" ]; then chown -R postgres "$DIR"; RUNAS=(sudo -u postgres); fi
"${RUNAS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/log" start >/dev/null
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'SQL'
create schema extensions;
create schema auth;
create schema storage;
create role authenticated nologin;
create role anon nologin;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
SQL

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

"${PSQL[@]}" -f "$ROOT/scripts/check-migrations.sql"
echo "migrations OK"
