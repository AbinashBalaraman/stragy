#!/usr/bin/env python3
"""End-to-end voice-live pipeline test without a microphone: synthesize a
user utterance with edge-tts, stream it as PCM over the WebSocket exactly
like the browser would, and verify transcript + reply audio + latencies."""
import asyncio
import base64
import io
import json
import sys
import time
import wave

import av
import edge_tts
import numpy as np
import websockets

SR = 16000


async def synth_pcm(text: str, voice: str) -> bytes:
    chunks = []
    async for c in edge_tts.Communicate(text, voice).stream():
        if c['type'] == 'audio':
            chunks.append(c['data'])
    mp3 = b''.join(chunks)
    with av.open(io.BytesIO(mp3)) as container:
        resampler = av.AudioResampler(format='s16', layout='mono', rate=SR)
        out = []
        for frame in container.decode(audio=0):
            for rf in resampler.resample(frame):
                out.append(rf.to_ndarray().tobytes())
    return b''.join(out)


async def run_turn(text: str, lang: str, voice: str, label: str):
    pcm = await synth_pcm(text, voice)
    print(f'[{label}] user audio: {len(pcm)/2/SR:.2f}s')
    events = []
    audio_out = bytearray()
    t_start = time.time()
    t_transcript = t_first_audio = t_done = None
    async with websockets.connect('ws://127.0.0.1:8766/voice/ws', max_size=8*1024*1024) as ws:
        await ws.send(json.dumps({'type': 'start', 'lang': lang}))
        ready = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert ready['type'] == 'ready', ready

        async def feed():
            step = SR * 2 // 10  # 100 ms
            for i in range(0, len(pcm), step):
                await ws.send(json.dumps({'type': 'audio_chunk', 'audio': base64.b64encode(pcm[i:i+step]).decode()}))
                await asyncio.sleep(0.1)
            # trailing silence triggers VAD end-of-turn
            silence = b'\x00' * step
            for _ in range(12):
                await ws.send(json.dumps({'type': 'audio_chunk', 'audio': base64.b64encode(silence).decode()}))
                await asyncio.sleep(0.1)

        feed_task = asyncio.create_task(feed())
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), 90)
                ev = json.loads(raw)
                events.append(ev['type'])
                if ev['type'] == 'transcript':
                    t_transcript = time.time() - t_start
                    print(f'[{label}] transcript ({t_transcript:.1f}s): {ev["text"]}')
                elif ev['type'] == 'audio_chunk':
                    if t_first_audio is None:
                        t_first_audio = time.time() - t_start
                    audio_out.extend(base64.b64decode(ev['audio']))
                elif ev['type'] == 'assistant_finished_speaking':
                    t_done = time.time() - t_start
                    break
                elif ev['type'] == 'error':
                    print(f'[{label}] ERROR: {ev["message"]}')
                    break
        finally:
            feed_task.cancel()
        await ws.send(json.dumps({'type': 'stop'}))
    print(f'[{label}] first audio: {t_first_audio and round(t_first_audio,1)}s, done: {t_done and round(t_done,1)}s, reply audio: {len(audio_out)/2/SR:.1f}s')
    print(f'[{label}] events: {events[:14]}')
    if audio_out:
        with wave.open(f'/data/workspace/gate-logs/voice-reply-{label}.wav', 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes(bytes(audio_out))
    return t_transcript is not None and len(audio_out) > 0


async def main():
    ok_en = await run_turn('What is a stop loss and why does it matter?', 'en', 'en-US-GuyNeural', 'en')
    ok_ta = await run_turn('இன்று சந்தை எப்படி இருந்தது?', 'ta', 'ta-IN-PallaviNeural', 'ta')
    print('RESULT:', 'PASS' if ok_en and ok_ta else 'FAIL')
    sys.exit(0 if ok_en and ok_ta else 1)

if __name__ == '__main__':
    asyncio.run(main())
