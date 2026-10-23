#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d .next ]]; then
  echo "Authentication checks failed: run npm run build before this script"
  exit 1
fi

cleanup() {
  status=$?
  docker compose down --remove-orphans >/tmp/devflow-auth-compose-down.log 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

if ! docker compose up -d --wait --wait-timeout 60; then
  echo "Authentication checks failed: Postgres did not become healthy within 60 seconds"
  docker compose ps || true
  docker compose logs || true
  exit 1
fi

# The auth tests create and migrate their own database. An inherited
# DATABASE_URL must not select a developer database.
if ! env -u DATABASE_URL npm run test:auth; then
  echo "Authentication checks failed: auth tests did not pass"
  exit 1
fi

echo "Authentication checks passed"
