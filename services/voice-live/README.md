# Stragy live voice — hands-free, streaming, interruptible

Replaces push-to-talk with a live conversation: **speak → pause → it answers →
talk over it to interrupt.** No stop button, no whole-clip upload wait.

## Pipeline (all free)

```
mic PCM16 16kHz (AudioWorklet, 100ms frames)
  → WebSocket /voice/ws (through the frontend proxy, Basic-auth gated)
  → Silero VAD (2.3MB ONNX) — auto turn-taking on ~700ms silence
  → faster-whisper tiny (en) / small (ta), local CPU int8
  → OpenRouter free-model chain (streaming): particle-1 → flint → ling-flash
    → gemma-4 → lfm-3; last resort: the stack's own free opencode-go model
  → sentence/clause split → LOCAL TTS: piper int8 18 MB (en) + piper Tamil 61 MB (ta)
    → 100ms PCM chunks back → gapless browser playback queue
No cloud TTS by default. VOICE_TTS=edge / VOICE_TTS_TAMIL=edge opt into free
neural voices; VOICE_TTS_TAMIL=espeak gives fully offline robotic Tamil.
The reasoning LLM stays on the free OpenRouter chain: a local 0.5B Q4 model
was benchmarked at 0.7 tokens/s on this 4-CPU host (34s for 8 tokens), far too
slow for a live turn. On a faster machine, llama.cpp + qwen2.5-0.5b-q4_k_m.gguf
can serve /v1/chat/completions locally; wire it via VOICE_LLM=local later.
```

Barge-in: the mic stays hot while the assistant speaks; ≥300ms of detected
speech cancels generation and starts a new turn. Echo cancellation on the
getUserMedia track keeps the assistant's own voice from triggering it.

Honest failure paths: every model rate-limited → spoken/text error, conversation
stays alive; edge-tts unreachable → espeak-ng fallback; no mic → visible error
strip with retry. No paid endpoint is ever called.

## Files

- `server.py` — the WebSocket service (loopback :8766)
- `silero_vad.onnx` — VAD model (2.3MB, MIT-licensed Silero)
- `test_pipeline.py` — end-to-end test without a microphone: synthesizes a
  user utterance with edge-tts, streams it like the browser, asserts
  transcript + reply audio in English and Tamil
- `setup.sh` — fresh-machine setup (venv + deps + VAD download)
- `run.sh` — start the service

## Run

```bash
./setup.sh                      # once per machine
STRAGY_ENV_FILE=/path/to/stragy-code/.env ./run.sh
```

The frontend proxy (`scripts/frontend-proxy.mjs`) routes `/voice/*` (HTTP +
WebSocket) to `VOICE_PORT` (default 8766). The browser engine is
`src/frontend/voice/live.ts` + `useLiveVoice.ts`; the composer's headphones
button starts/ends the conversation.

## Latency notes

- Whisper tiny (en) ≈ 1–2s per utterance; small (ta) ≈ 4–11s on this CPU —
  Tamil accuracy needs the bigger model.
- OpenRouter free tiers rate-limit in waves; the chain hops immediately
  (no retries) and falls back to opencode-go. Adding OpenRouter credits
  raises the free-tier limits substantially if this becomes annoying.
- edge-tts opens one connection per sentence; first audio typically ~1–2s
  after the first sentence lands.
