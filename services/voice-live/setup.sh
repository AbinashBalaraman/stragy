#!/usr/bin/env bash
# Fresh-machine setup for the live voice service.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv --system-site-packages .venv
# sherpa-onnx 1.12.x reads piper models with espeak-ng-data directly; 2.x
# needs an explicit lexicon/phoneme frontend and fails on this voice.
.venv/bin/pip install --quiet 'sherpa-onnx>=1.12,<2' piper-tts edge-tts onnxruntime websockets numpy
# faster-whisper + PyAV come from system site-packages on the Stragy host;
# install them here if missing:
.venv/bin/python -c "import faster_whisper, av" 2>/dev/null || .venv/bin/pip install --quiet faster-whisper av
if [ ! -f silero_vad.onnx ]; then
  curl -sL -o silero_vad.onnx https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
fi
if [ ! -f models/en/en_US-amy-low.onnx ]; then
  mkdir -p models/en
  curl -sL -o /tmp/stragy-tts.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-low-int8.tar.bz2
  tar -xjf /tmp/stragy-tts.tar.bz2 -C models/en --strip-components=1
  rm /tmp/stragy-tts.tar.bz2
fi
if [ ! -f models/ta/ta_IN-HemaLatha-medium.onnx ]; then
  mkdir -p models/ta
  base=https://huggingface.co/Jeyaram-K/piper-tamil-voices/resolve/main/ta_IN-HemaLatha-medium
  curl -sL -o models/ta/ta_IN-HemaLatha-medium.onnx "$base/ta_IN-HemaLatha-medium.onnx"
  curl -sL -o models/ta/ta_IN-HemaLatha-medium.onnx.json "$base/ta_IN-HemaLatha-medium.onnx.json"
fi
echo "setup done — run: STRAGY_ENV_FILE=/path/to/.env ./run.sh"
