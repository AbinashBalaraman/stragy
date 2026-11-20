#!/usr/bin/env bash
# Start the live voice service (loopback only; the proxy is the public gate).
set -euo pipefail
cd "$(dirname "$0")"
PY="${VOICE_PYTHON:-./.venv/bin/python}"
if [ ! -x "$PY" ]; then PY=/data/workspace/voice-live/.venv/bin/python; fi
exec "$PY" server.py --host 127.0.0.1 --port "${VOICE_PORT:-8766}"
