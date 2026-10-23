#!/usr/bin/env bash
set -euo pipefail

unset DATABASE_URL

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "Production smoke check failed: DATABASE_URL is set"
  exit 1
fi

if [[ ! -d .next ]]; then
  echo "Production smoke check failed: run npm run build before this script"
  exit 1
fi

if timeout 1 bash -c 'echo >/dev/tcp/127.0.0.1/3000' 2>/dev/null; then
  echo "Production smoke check failed: 127.0.0.1:3000 is already in use"
  exit 1
fi

pid=""
log="$(mktemp)"

cleanup() {
  status=$?
  if [[ -n "$pid" ]]; then
    kill -- "-$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$log"
  exit "$status"
}
trap cleanup EXIT

setsid env -u DATABASE_URL npm run start >"$log" 2>&1 &
pid=$!

body=""
code=""
for _ in $(seq 1 40); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Production smoke check failed: server exited before listening"
    cat "$log"
    exit 1
  fi

  code="$(curl -sS -o /tmp/devflow-production-smoke.html -w "%{http_code}" --max-time 2 http://127.0.0.1:3000/ 2>/dev/null || true)"
  if [[ "$code" == "200" ]]; then
    body="$(cat /tmp/devflow-production-smoke.html)"
    break
  fi
  sleep 0.5
done

if [[ "$code" != "200" ]]; then
  echo "Production smoke check failed: expected HTTP 200 from http://127.0.0.1:3000/, got ${code:-no response}"
  cat "$log"
  exit 1
fi

if [[ "$body" != *"Application scaffold is running."* || "$body" != *">DevFlow</h1>"* ]]; then
  echo "Production smoke check failed: page content did not match the scaffold page"
  exit 1
fi

headers="$(curl -sS -D - -o /dev/null --max-time 2 http://127.0.0.1:3000/)"
if grep -qi '^x-powered-by:' <<<"$headers"; then
  echo "Production smoke check failed: X-Powered-By header is present"
  exit 1
fi

echo "Production smoke check passed"
