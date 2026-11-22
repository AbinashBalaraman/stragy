#!/usr/bin/env python3
"""Stragy live voice — hands-free, streaming, interruptible.

Pipeline: mic PCM -> Silero VAD (auto turn-taking, no stop button) ->
faster-whisper tiny -> OpenRouter free-model chain (streaming) ->
sentence-split -> small LOCAL TTS (sherpa-onnx piper int8, 18 MB EN;
  piper Tamil 61 MB) -> PCM -> browser. No cloud TTS by default.
  VOICE_TTS=edge / VOICE_TTS_TAMIL=edge opt into free neural voices instead.
The reasoning model stays on the free OpenRouter chain: a local 0.5B Q4 LLM
was benchmarked here at 0.7 tokens/s on 4 contended CPUs — far too slow for
live speech. The CPU host is the limit, not the model size.
Barge-in: the mic stays hot while the assistant speaks; detected speech
cancels generation and starts a new turn.

Protocol (JSON over WebSocket at /voice/ws), audio is base64 PCM16 mono 16 kHz:
  client -> server: {"type":"start","lang":"en"|"ta"}
                    {"type":"audio_chunk","audio":"<b64>"}
                    {"type":"stop"}
  server -> client: {"type":"ready"}
                    {"type":"speech_start"} / {"type":"speech_end"}
                    {"type":"transcript","text":"..."}
                    {"type":"thinking","model":"..."}
                    {"type":"assistant_started_speaking"}
                    {"type":"audio_chunk","audio":"<b64>"}
                    {"type":"assistant_finished_speaking"}
                    {"type":"interrupted"}
                    {"type":"error","message":"..."}

Free-only: OpenRouter :free models, local whisper + VAD + English TTS,
free edge-tts for Tamil. Offline TTS fallback: espeak-ng. No paid API is ever called.
"""
import argparse
import asyncio
import base64
import io
import json
import os
import queue
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import numpy as np
import onnxruntime as ort
import websockets
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000
VAD_WINDOW = 512  # 32 ms at 16 kHz, silero's expected frame
SPEECH_THRESHOLD = 0.5
SILENCE_END_MS = 700
MIN_SPEECH_MS = 280
BARGE_IN_MS = 300
MAX_UTTERANCE_S = 30
HISTORY_TURNS = 8

MODELS = [
    'particle-ai/particle-1:free',
    'recursive/flint-v1.0:free',
    'inclusionai/ling-3.2-flash:free',
    'google/gemma-4-26b-a4b-it:free',
    'liquid/lfm-3-1.7b:free',
]
# OpenRouter free tiers are shared and rate-limit in waves; the stack's own
# free chat provider is the last-resort fallback so a turn never dead-ends.
# Both are free; no paid endpoint is ever called.
CHAIN = [('openrouter', m) for m in MODELS] + [('opencode-go', 'hy4-flash-free')]
VOICES = {'en': 'en-US-AvaMultilingualNeural', 'ta': 'ta-IN-PallaviNeural'}
_LOCAL_TTS = None  # lazily created sherpa-onnx piper voice; no network, ~18 MB
_TAMIL_TTS = None  # piper-tts Tamil voice (61 MB), fully local
SYSTEM_PROMPT = (
    'You are Stragy, a voice research assistant for Indian stock-market research. '
    'Answer in at most three short sentences. No markdown, no lists, no tables, no emoji. '
    'Reply in the same language as the user (Tamil if they speak Tamil). '
    'Be honest about uncertainty; never invent market numbers.'
)

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE_SESSION = str(uuid.uuid4())


class _QueueReader(io.RawIOBase):
    """Blocking file-like object fed by a queue — lets PyAV decode a live stream."""

    def __init__(self):
        super().__init__()
        self.q: queue.Queue = queue.Queue()
        self.buf = b''

    def feed(self, data: bytes):
        self.q.put(data)

    def close(self):
        self.q.put(None)

    def readable(self):
        return True

    def seekable(self):
        return False

    def read(self, n=-1):
        while not self.buf:
            try:
                item = self.q.get(timeout=20)
            except queue.Empty:
                raise TimeoutError('TTS feed stalled (no audio for 20 s)')
            if item is None:
                return b''
            self.buf = item
        if n is None or n < 0 or n >= len(self.buf):
            out, self.buf = self.buf, b''
            return out
        out, self.buf = self.buf[:n], self.buf[n:]
        return out


def load_env_key(name: str) -> str:
    env_file = os.environ.get('STRAGY_ENV_FILE', '/data/home/oc-import/Stragy/stragy-code/.env')
    try:
        for line in open(env_file, encoding='utf-8'):
            if line.startswith(name + '='):
                return line.split('=', 1)[1].strip().strip('"').strip("'").rstrip('\r')
    except OSError:
        pass
    return os.environ.get(name, '')


class SileroVad:
    def __init__(self, path: str):
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        self.sess = ort.InferenceSession(path, opts, providers=['CPUExecutionProvider'])
        self.reset()

    def reset(self):
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.context = np.zeros((1, 64), dtype=np.float32)

    def prob(self, chunk: np.ndarray) -> float:
        x = np.concatenate([self.context, chunk.reshape(1, -1)], axis=1)
        out, self.state = self.sess.run(
            None, {'input': x, 'state': self.state, 'sr': np.array(SAMPLE_RATE, dtype=np.int64)})
        self.context = x[:, -64:]
        return float(out[0][0])


class Conversation:
    """One WebSocket = one conversation. Audio in, events out, barge-in aware."""

    def __init__(self, ws, loop, vad: SileroVad, whisper: dict, providers: dict):
        self.ws = ws
        self.loop = loop
        self.vad = vad
        self.whisper = whisper
        self.providers = providers
        self.lang = 'en'
        self.history: list[dict] = []
        self.out: queue.Queue = queue.Queue()
        self.cancel = threading.Event()
        self.worker: threading.Thread | None = None
        # turn state
        self.speaking = False
        self.speech_ms = 0
        self.silence_ms = 0
        self.utterance = bytearray()
        self.assistant_speaking = False
        self.barge_ms = 0
        self.last_active = time.time()

    def emit(self, obj: dict):
        self.out.put(obj)

    def feed(self, pcm: bytes):
        self.last_active = time.time()
        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        for i in range(0, len(samples) - VAD_WINDOW + 1, VAD_WINDOW):
            window = samples[i:i + VAD_WINDOW]
            p = self.vad.prob(window)
            ms = VAD_WINDOW / SAMPLE_RATE * 1000
            if self.assistant_speaking:
                # Barge-in: sustained user speech interrupts the assistant.
                if p >= SPEECH_THRESHOLD:
                    self.barge_ms += ms
                    if self.barge_ms >= BARGE_IN_MS:
                        self.interrupt()
                        self.speaking = True
                        self.speech_ms = self.barge_ms
                        self.silence_ms = 0
                        self.utterance = bytearray()
                        self.vad.reset()
                        self.emit({'type': 'speech_start'})
                else:
                    self.barge_ms = 0
                continue
            if p >= SPEECH_THRESHOLD:
                if not self.speaking:
                    self.speaking = True
                    self.speech_ms = 0
                    self.silence_ms = 0
                    self.utterance = bytearray()
                    self.vad.reset()
                    self.emit({'type': 'speech_start'})
                self.speech_ms += ms
                self.silence_ms = 0
                self.utterance.extend(window.astype(np.float32).tobytes())
            elif self.speaking:
                self.silence_ms += ms
                self.utterance.extend(window.astype(np.float32).tobytes())
                if self.silence_ms >= SILENCE_END_MS or self.speech_ms >= MAX_UTTERANCE_S * 1000:
                    self.end_utterance()
        # cap runaway buffers
        if len(self.utterance) > MAX_UTTERANCE_S * SAMPLE_RATE * 4:
            self.end_utterance()

    def interrupt(self):
        if self.worker and self.worker.is_alive():
            self.cancel.set()
        self.assistant_speaking = False
        self.barge_ms = 0
        self.emit({'type': 'interrupted'})

    def end_utterance(self):
        if self.speech_ms < MIN_SPEECH_MS:
            self.speaking = False
            self.utterance = bytearray()
            return
        audio = bytes(self.utterance)
        self.speaking = False
        self.utterance = bytearray()
        self.silence_ms = 0
        self.emit({'type': 'speech_end'})
        self.cancel = threading.Event()
        self.worker = threading.Thread(target=self.run_turn, args=(audio, self.cancel), daemon=True)
        self.worker.start()

    # ---- turn pipeline (worker thread) -------------------------------------
    def run_turn(self, audio: bytes, cancel: threading.Event):
        try:
            # Float32 array input skips faster-whisper's av decoder (version-
            # sensitive); the VAD already gave us clean 16 kHz mono PCM.
            # tiny is fast and accurate for English; Tamil needs `small`.
            samples = np.frombuffer(audio, dtype=np.float32)
            model = self.whisper.get(self.lang) or self.whisper['en']
            segments, _ = model.transcribe(
                samples, language=self.lang, beam_size=1,
                vad_filter=False, condition_on_previous_text=False)
            text = ' '.join(s.text.strip() for s in segments).strip()
            if cancel.is_set():
                return
            if not text:
                self.emit({'type': 'error', 'message': 'No speech recognized — try again.'})
                return
            self.emit({'type': 'transcript', 'text': text})
            self.history.append({'role': 'user', 'content': text})
            self.history = self.history[-HISTORY_TURNS * 2:]
            self.generate_reply(cancel)
        except Exception as exc:  # noqa: BLE001 - surface honestly, keep the loop alive
            self.emit({'type': 'error', 'message': f'{type(exc).__name__}: {exc}'})

    def generate_reply(self, cancel: threading.Event):
        turn_deadline = time.monotonic() + 60
        sentence_buf = ''
        started = False
        full_reply = ''
        used_model = ''
        for provider, model in CHAIN:
            if cancel.is_set():
                return
            if time.monotonic() > turn_deadline:
                break
            base_url, key = self.providers.get(provider, (None, None))
            if not key:
                continue
            # No 429 retries here: voice must move to the next free model
            # immediately instead of making the listener wait.
            for attempt in range(1):
                try:
                    self.emit({'type': 'thinking', 'model': f'{provider}/{model}'})
                    got_any = False
                    for token in self.stream_chat(provider, base_url, key, model, cancel):
                        if cancel.is_set():
                            return
                        got_any = True
                        sentence_buf += token
                        full_reply += token
                        # Emit complete sentences early; also flush a long first
                        # clause so speech starts before a full sentence lands.
                        while True:
                            m = re.search(r'[.!?।\n]', sentence_buf)
                            cut = m.end() if m else -1
                            if cut <= 0 and not started:
                                # Start speaking at the first clause, not the first
                                # full sentence — cuts time-to-first-audio sharply.
                                c = sentence_buf.find(',')
                                if c >= 30:
                                    cut = c + 1
                                elif len(sentence_buf) > 100:
                                    cut = len(sentence_buf)
                            if cut <= 0 and started and len(sentence_buf) > 140:
                                cut = len(sentence_buf)
                            if cut <= 0:
                                break
                            sentence, sentence_buf = sentence_buf[:cut].strip(), sentence_buf[cut:]
                            if len(sentence) < 2:
                                continue
                            if not started:
                                started = True
                                used_model = model
                                self.assistant_speaking = True
                                self.emit({'type': 'assistant_started_speaking'})
                            self.speak_sentence(sentence, cancel)
                            if cancel.is_set():
                                return
                    if got_any:
                        if sentence_buf.strip():
                            if not started:
                                started = True
                                used_model = model
                                self.assistant_speaking = True
                                self.emit({'type': 'assistant_started_speaking'})
                            self.speak_sentence(sentence_buf.strip(), cancel)
                        break
                    # empty response (e.g. reasoning-only model) -> try next
                    print(f'[voice-live] {model}: empty content, trying next', flush=True)
                    break
                except urllib.error.HTTPError as exc:
                    print(f'[voice-live] {model}: HTTP {exc.code} (attempt {attempt + 1})', flush=True)
                    if exc.code == 429 and attempt == 0 and not cancel.is_set():
                        time.sleep(1.5)
                        continue
                    break
                except (urllib.error.URLError, TimeoutError, OSError) as exc:
                    print(f'[voice-live] {model}: {type(exc).__name__} {exc}', flush=True)
                    break
            if started or cancel.is_set():
                break
        if cancel.is_set():
            return
        if started:
            self.history.append({'role': 'assistant', 'content': full_reply})
            self.assistant_speaking = False
            self.emit({'type': 'assistant_finished_speaking', 'model': used_model})
        else:
            self.emit({'type': 'error', 'message': 'All free models are rate-limited right now. Try again in a moment.'})

    def stream_chat(self, provider: str, base_url: str, key: str, model: str, cancel: threading.Event):
        body = json.dumps({
            'model': model, 'stream': True, 'max_tokens': 220,
            'messages': [{'role': 'system', 'content': SYSTEM_PROMPT}] + self.history,
        }).encode()
        headers = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
        if provider == 'opencode-go':
            # Go requires a client identity and a stable conversation header.
            headers['User-Agent'] = 'stragy-research/2.0'
            headers['x-opencode-session'] = VOICE_SESSION
        req = urllib.request.Request(
            base_url.rstrip('/') + '/chat/completions', data=body, headers=headers)
        # Hard wall-clock deadline: rate-limited endpoints can hold a connection
        # open and trickle nothing; urllib's per-op timeout alone never fires.
        deadline = time.monotonic() + 20
        with urllib.request.urlopen(req, timeout=12) as resp:
            for raw in resp:
                if cancel.is_set() or time.monotonic() > deadline:
                    return
                line = raw.decode('utf-8', 'replace').strip()
                if not line.startswith('data:'):
                    continue
                payload = line[5:].strip()
                if payload == '[DONE]':
                    return
                try:
                    delta = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choices = delta.get('choices') or [{}]
                content = (choices[0].get('delta') or {}).get('content')
                if content:
                    yield content

    def speak_sentence(self, sentence: str, cancel: threading.Event):
        voice = VOICES.get(self.lang, VOICES['en'])
        mode = os.environ.get('VOICE_TTS', 'local').lower()
        if mode == 'local' and self.lang == 'en':
            try:
                self.speak_local(sentence, cancel)
                return
            except Exception as exc:  # noqa: BLE001 - network/offline fallback
                print(f'[voice-live] local TTS unavailable: {type(exc).__name__} {exc}', flush=True)
        if self.lang == 'ta':
            mode_ta = os.environ.get('VOICE_TTS_TAMIL', 'local').lower()
            if mode_ta == 'local':
                try:
                    self.speak_tamil_local(sentence, cancel)
                    return
                except Exception as exc:  # noqa: BLE001 - fall back below
                    print(f'[voice-live] Tamil local TTS unavailable: {type(exc).__name__} {exc}', flush=True)
            if mode_ta in ('espeak', 'offline'):
                self.speak_espeak(sentence, cancel)
                return
        try:
            self.speak_edge(sentence, voice, cancel)
        except Exception:  # noqa: BLE001 - offline fallback keeps the conversation alive
            if not cancel.is_set():
                self.speak_espeak(sentence, cancel)

    def speak_local(self, sentence: str, cancel: threading.Event):
        """Small local neural TTS: ~18 MB int8 piper voice, no network."""
        import sherpa_onnx

        global _LOCAL_TTS
        if _LOCAL_TTS is None:
            root = Path(__file__).resolve().parent / 'models' / 'en'
            _LOCAL_TTS = sherpa_onnx.OfflineTts(config=sherpa_onnx.OfflineTtsConfig(
                model=sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=str(root / 'en_US-amy-low.onnx'), tokens=str(root / 'tokens.txt'),
                    data_dir=str(root / 'espeak-ng-data')), num_threads=2, provider='cpu'),
                max_num_sentences=1))
        audio = _LOCAL_TTS.generate(sentence, sid=0, speed=1.0)
        samples = np.asarray(audio.samples, dtype=np.float32)
        if not len(samples) or cancel.is_set():
            return
        if audio.sample_rate != SAMPLE_RATE:
            idx = np.linspace(0, len(samples) - 1, int(len(samples) * SAMPLE_RATE / audio.sample_rate)).astype(int)
            samples = samples[idx]
        pcm = np.clip(samples * 32767, -32768, 32767).astype(np.int16).tobytes()
        step = SAMPLE_RATE * 2 // 10
        for i in range(0, len(pcm), step):
            if cancel.is_set():
                return
            self.emit({'type': 'audio_chunk', 'audio': base64.b64encode(pcm[i:i + step]).decode()})

    def speak_tamil_local(self, sentence: str, cancel: threading.Event):
        """Local neural Tamil TTS: piper VITS ONNX (61 MB), no network."""
        from piper import PiperVoice

        global _TAMIL_TTS
        if _TAMIL_TTS is None:
            model = Path(__file__).resolve().parent / 'models' / 'ta' / 'ta_IN-HemaLatha-medium.onnx'
            _TAMIL_TTS = PiperVoice.load(str(model))
        chunks = list(_TAMIL_TTS.synthesize(sentence))
        if cancel.is_set() or not chunks:
            return
        samples = np.concatenate([chunk.audio_int16_array for chunk in chunks]).astype(np.float32)
        rate = _TAMIL_TTS.config.sample_rate
        if rate != SAMPLE_RATE:
            idx = np.linspace(0, len(samples) - 1, int(len(samples) * SAMPLE_RATE / rate)).astype(int)
            samples = samples[idx]
        pcm = np.clip(samples, -32768, 32767).astype(np.int16).tobytes()
        step = SAMPLE_RATE * 2 // 10
        for i in range(0, len(pcm), step):
            if cancel.is_set():
                return
            self.emit({'type': 'audio_chunk', 'audio': base64.b64encode(pcm[i:i + step]).decode()})

    def speak_edge(self, sentence: str, voice: str, cancel: threading.Event):
        import edge_tts

        reader = _QueueReader()

        async def feed():
            print(f'[voice-live] tts feed start: {sentence[:40]!r}', flush=True)
            n = 0
            try:
                async for chunk in edge_tts.Communicate(sentence, voice).stream():
                    if chunk['type'] == 'audio':
                        n += 1
                        if n == 1:
                            print('[voice-live] tts first chunk', flush=True)
                        reader.feed(chunk['data'])
            except Exception as exc:  # noqa: BLE001 - decode side surfaces the failure
                print(f'[voice-live] tts feed error: {type(exc).__name__} {exc}', flush=True)
            finally:
                print(f'[voice-live] tts feed done ({n} chunks)', flush=True)
                reader.close()

        asyncio.run_coroutine_threadsafe(feed(), self.loop)
        self.stream_mp3_as_pcm(reader, cancel)

    def stream_mp3_as_pcm(self, source, cancel: threading.Event):
        import av

        # Decode MP3 frames as they arrive (queue-backed reader) so speech
        # starts ~1 s into synthesis instead of waiting for the whole sentence.
        with av.open(source, format='mp3') as container:
            resampler = av.AudioResampler(format='s16', layout='mono', rate=SAMPLE_RATE)
            for frame in container.decode(audio=0):
                if cancel.is_set():
                    if hasattr(source, 'close'):
                        source.close()
                    return
                for rf in resampler.resample(frame):
                    pcm = rf.to_ndarray().tobytes()
                    # ~100 ms chunks for smooth playback + fast barge-in
                    step = SAMPLE_RATE * 2 // 10
                    for i in range(0, len(pcm), step):
                        if cancel.is_set():
                            return
                        self.emit({'type': 'audio_chunk', 'audio': base64.b64encode(pcm[i:i + step]).decode()})

    def speak_espeak(self, sentence: str, cancel: threading.Event):
        voice = 'ta' if self.lang == 'ta' else 'en-us'
        proc = subprocess.run(
            ['espeak-ng', '-v', voice, '-s', '165', '--stdout', '--', sentence],
            capture_output=True, timeout=20)
        if cancel.is_set() or proc.returncode != 0 or not proc.stdout:
            return
        # espeak WAV -> skip 44-byte header, already 22050 Hz s16 mono; resample naively
        pcm = proc.stdout[44:]
        arr = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
        idx = np.linspace(0, len(arr) - 1, int(len(arr) * SAMPLE_RATE / 22050)).astype(int)
        out = arr[idx].astype(np.int16).tobytes()
        step = SAMPLE_RATE * 2 // 10
        for i in range(0, len(out), step):
            if cancel.is_set():
                return
            self.emit({'type': 'audio_chunk', 'audio': base64.b64encode(out[i:i + step]).decode()})


async def handler(ws, vad_factory, whisper, providers):
    loop = asyncio.get_running_loop()
    conv = Conversation(ws, loop, vad_factory(), whisper, providers)
    await ws.send(json.dumps({'type': 'ready'}))

    async def sender():
        while True:
            try:
                obj = await loop.run_in_executor(None, conv.out.get, True, 0.25)
            except queue.Empty:
                continue
            try:
                await ws.send(json.dumps(obj))
            except websockets.ConnectionClosed:
                return

    send_task = asyncio.create_task(sender())
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            kind = msg.get('type')
            if kind == 'start':
                conv.lang = 'ta' if msg.get('lang') == 'ta' else 'en'
            elif kind == 'audio_chunk':
                try:
                    conv.feed(base64.b64decode(msg.get('audio', '')))
                except Exception:  # noqa: BLE001 - bad chunk must not kill the session
                    pass
            elif kind == 'stop':
                break
    except websockets.ConnectionClosed:
        pass
    finally:
        conv.cancel.set()
        send_task.cancel()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()

    providers = {
        'openrouter': ('https://openrouter.ai/api/v1', load_env_key('OPENROUTER_API_KEY')),
        'opencode-go': ('https://opencode.ai/inference/go/openai/v1', load_env_key('OPENCODE_API_KEY')),
    }
    if not providers['openrouter'][1] and not providers['opencode-go'][1]:
        raise SystemExit('No provider key found (set STRAGY_ENV_FILE or OPENROUTER_API_KEY/OPENCODE_API_KEY)')
    vad_path = os.path.join(HERE, 'silero_vad.onnx')
    print('loading silero vad + whisper tiny (en) + small (ta)...', flush=True)
    vad_factory = lambda: SileroVad(vad_path)  # noqa: E731 - per-connection state
    whisper = {
        'en': WhisperModel('tiny', device='cpu', compute_type='int8'),
        'ta': WhisperModel('small', device='cpu', compute_type='int8'),
    }
    print(f'voice-live ready on ws://{args.host}:{args.port}/voice/ws', flush=True)
    async with websockets.serve(
            lambda ws: handler(ws, vad_factory, whisper, providers),
            args.host, args.port, max_size=4 * 1024 * 1024, ping_interval=20):
        await asyncio.Future()


if __name__ == '__main__':
    asyncio.run(main())
