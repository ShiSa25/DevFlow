#!/usr/bin/env bash
set -euo pipefail

chrome_present() {
  if [[ -n "${CHROME_BIN:-}" && -x "${CHROME_BIN}" ]]; then
    return 0
  fi
  if [[ -x /opt/google/chrome/chrome || -x /usr/local/share/chromium/chrome-linux/chrome ]]; then
    return 0
  fi
  command -v google-chrome >/dev/null 2>&1 && return 0
  command -v google-chrome-stable >/dev/null 2>&1 && return 0
  command -v chromium >/dev/null 2>&1 && return 0
  command -v chromium-browser >/dev/null 2>&1 && return 0
  return 1
}

if [[ ! -d .next ]]; then
  echo "Project checks failed: run npm run build before this script"
  exit 1
fi

cleanup() {
  status=$?
  docker compose down --remove-orphans >/tmp/devflow-project-compose-down.log 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

if ! docker compose up -d --wait --wait-timeout 60; then
  echo "Project checks failed: Postgres did not become healthy within 60 seconds"
  docker compose ps || true
  docker compose logs || true
  exit 1
fi

# The edit revalidation check drives headless Chrome. GitHub-hosted runners
# usually already have it (CHROME_BIN). Install the official build only when
# this machine does not, so the check still runs.
if ! chrome_present; then
  echo "Installing Google Chrome for the project browser check"
  deb="$(mktemp --suffix=.deb)"
  curl -fsSL -o "$deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y "$deb"
  else
    apt-get update -qq
    apt-get install -y "$deb"
  fi
  rm -f "$deb"
fi
if [[ -x /opt/google/chrome/chrome ]]; then
  export CHROME_BIN="/opt/google/chrome/chrome"
elif [[ -z "${CHROME_BIN:-}" || ! -x "${CHROME_BIN}" ]]; then
  if command -v google-chrome >/dev/null 2>&1; then
    CHROME_BIN="$(command -v google-chrome)"
    export CHROME_BIN
  elif command -v chromium >/dev/null 2>&1; then
    CHROME_BIN="$(command -v chromium)"
    export CHROME_BIN
  fi
fi

# Project tests create and migrate their own database. An inherited
# DATABASE_URL must not select a developer database.
if ! env -u DATABASE_URL CHROME_BIN="${CHROME_BIN:-}" npm run test:projects; then
  echo "Project checks failed: project tests did not pass"
  exit 1
fi

echo "Project checks passed"
