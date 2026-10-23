#!/usr/bin/env bash
set -euo pipefail

# Always target the Compose database from .env.example. An inherited
# DATABASE_URL must not redirect migrations or the smoke query.
export DATABASE_URL="postgres://devflow:devflow@localhost:5432/devflow"

cleanup() {
  status=$?
  docker compose down --remove-orphans >/tmp/devflow-compose-down.log 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

if ! docker compose up -d --wait --wait-timeout 60; then
  echo "Database smoke check failed: Postgres did not become healthy within 60 seconds"
  docker compose ps || true
  docker compose logs || true
  exit 1
fi

if ! npm run db:migrate; then
  echo "Database smoke check failed: migrations did not apply"
  exit 1
fi

if ! npm run db:smoke; then
  echo "Database smoke check failed: SELECT 1 through the application client did not succeed"
  exit 1
fi

docker compose ps
echo "Database smoke check passed"
