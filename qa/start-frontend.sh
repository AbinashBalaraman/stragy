#!/usr/bin/env bash
# Start (or leave running) the custom Stragy frontend proxy on :4300.
#
#   Custom frontend :4300  owns its own Basic login (one login for everything)
#   UI gate         :4200  owns the stock OpenCode UI — untouched fallback
#   Stragy engine   :3100  API-only jobs/cache (no old React UI)
#
# The proxy targets :4200 (never :4201) for /opencode/* and :3100 for /api/*.
# Publishing :4300 is deliberately left to the QA/deploy subagent.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Works both from stragy-code/qa/ (repo) and from the parent qa/ directory.
if [ -f "$HERE/../package.json" ]; then
  APP_DIR="$(cd "$HERE/.." && pwd)"
else
  APP_DIR="$(cd "$HERE/../stragy-code" && pwd)"
fi
APP_DATA="$APP_DIR/../opencode-app-data"
PORT="${FRONTEND_PORT:-4300}"
NODE_BIN=/data/home/.local/node26/bin
LOG=/tmp/opencode/frontend-proxy.log
PID_FILE="$(dirname "$APP_DIR")/qa/frontend-proxy.pid"

export PATH="$NODE_BIN:$PATH"
export STRAGY_PORT="${STRAGY_PORT:-3100}"
mkdir -p /tmp/opencode "$APP_DATA"

cd "$APP_DIR"
set -a
# shellcheck disable=SC1091
source .env
set +a

# Idempotent: leave a healthy listener alone.
if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/healthz"; then
  echo "Frontend proxy already healthy on :$PORT"
  exit 0
fi

OLD=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)
if [ -n "${OLD:-}" ]; then
  echo "stopping stale frontend proxy pid $OLD"
  kill "$OLD" 2>/dev/null || true
  for _ in $(seq 1 20); do
    ss -ltnp 2>/dev/null | grep -q ":$PORT " || break
    sleep 0.5
  done
fi

if [ ! -d "$APP_DIR/dist/frontend" ]; then
  echo "dist/frontend missing — run npm run build:frontend first" >&2
  exit 1
fi

setsid nohup node scripts/frontend-proxy.mjs --port "$PORT" > "$LOG" 2>&1 &
echo $! > "$PID_FILE"

for _ in $(seq 1 30); do
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/healthz"; then break; fi
  sleep 0.5
done

if ! curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/healthz"; then
  echo "Frontend proxy did not answer on :$PORT" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

echo "Frontend proxy ready on http://127.0.0.1:$PORT (pid $(cat "$PID_FILE"))"
echo "Login: user 'opencode', password from $APP_DATA/password.txt"
echo "NOTE: :4300 is loopback-only. Do NOT publish until QA/deploy confirms auth."
