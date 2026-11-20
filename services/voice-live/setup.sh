#!/usr/bin/env bash
# Fresh-machine setup for the live voice service.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv --system-site-packages .venv
.venv/bin/pip install --quiet edge-tts onnxruntime websockets numpy
# faster-whisper + PyAV come from system site-packages on the Stragy host;
# install them here if missing:
.venv/bin/python -c "import faster_whisper, av" 2>/dev/null || .venv/bin/pip install --quiet faster-whisper av
if [ ! -f silero_vad.onnx ]; then
  curl -sL -o silero_vad.onnx https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
fi
echo "setup done — run: STRAGY_ENV_FILE=/path/to/.env ./run.sh"
