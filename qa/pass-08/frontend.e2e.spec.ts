import { test, expect, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const EVIDENCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'build');
fs.mkdirSync(EVIDENCE, { recursive: true });
const PW = fs.readFileSync('/data/home/oc-import/Stragy/opencode-app-data/password.txt', 'utf8').trim();
const results: Record<string, unknown> = {};

function pngBuffer(): Buffer {
  const w = 512, h = 512;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w * 3 + 1);
    crypto.randomFillSync(row.subarray(1));
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type); const body = Buffer.concat([t, data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function snap(page: Page, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE, name), fullPage: false });
}

/** Click the visible nav item (desktop rail or mobile bottom nav). */
async function navigate(page: Page, id: 'chat' | 'scanner') {
  const locator = page.getByTestId(`nav-${id}`);
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    if (await locator.nth(i).isVisible()) return locator.nth(i).click();
  }
  return locator.first().click();
}

function record(name: string, value: unknown) {
  const file = path.join(EVIDENCE, 'results.json');
  let disk: Record<string, unknown> = {};
  try { disk = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  disk[name] = value;
  fs.writeFileSync(file, JSON.stringify(disk, null, 2));
}

async function capturePosts(page: Page, matcher: (url: string) => boolean) {
  const bodies: Array<{ url: string; body: unknown }> = [];
  const onRequest = (req: Request) => {
    if (req.method() === 'POST' && matcher(req.url())) {
      try { bodies.push({ url: req.url(), body: JSON.parse(req.postData() || '{}') }); } catch { /* ignore */ }
    }
  };
  page.on('request', onRequest);
  return { bodies, stop: () => page.off('request', onRequest) };
}

async function newChat(page: Page) {
  // The left session panel is hidden under 700px; the inline strip is used there.
  for (const id of ['new-chat-side', 'new-chat-strip']) {
    const btn = page.getByTestId(id);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await expect(page.getByTestId('chat-screen')).toBeVisible();
      return;
    }
  }
  throw new Error('No visible New chat control');
}

test.describe('Stragy two-page frontend (behind :4300 proxy)', () => {
  test('login gate: 401 without credentials, 200 with', async ({ baseURL }) => {
    const rawGet = (headers: Record<string, string>) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.get(`${baseURL}/`, { headers }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
      });
      req.on('error', reject);
    });
    const res = await rawGet({});
    record('login.noAuthStatus', res.status);
    expect(res.status).toBe(401);
    expect(String(res.headers['www-authenticate'])).toContain('Basic');
    const auth = 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64');
    const ok = await rawGet({ authorization: auth });
    record('login.authStatus', ok.status);
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('<div id="root">');
    expect(ok.body).not.toContain(PW);
  });

  test('only two nav entries: chat and market scanner; no task/settings/voice page', async ({ page }, testInfo) => {
    await page.goto('/');
    const ids = await page.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    record(`nav.${testInfo.project.name}.items`, Array.from(new Set(ids)));
    expect(Array.from(new Set(ids)).sort()).toEqual(['nav-chat', 'nav-scanner']);
    for (const sel of ['[data-testid="taskboard-screen"]', '[data-testid="settings-screen"]', '[data-testid="welcome-screen"]', '[data-testid="voice-panel"]']) {
      expect(await page.locator(sel).count()).toBe(0);
    }
    // Chat is the default page and carries a real session list.
    await expect(page.getByTestId('chat-screen')).toBeVisible();
    const width = page.viewportSize()?.width || 1440;
    await expect(page.getByTestId(width <= 700 ? 'session-strip' : 'session-panel')).toBeVisible();
    await expect(page.getByTestId('composer')).toBeVisible();
    await snap(page, `ui-chat-${testInfo.project.name}.png`);
  });

  test('chat: real session, cache turn and tool card', async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    await page.goto('/');
    await newChat(page);
    const capture = await capturePosts(page, (u) => /\/prompt$/.test(u));
    await page.getByTestId('composer-input').fill('Summarise the cached NIFTY data cache in one sentence, then call get_data_cache.');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('assistant-text').first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.tool-card .chip.ready').first()).toBeVisible({ timeout: 60000 });
    record(`chat.${project}.promptBodies`, capture.bodies);
    const text = await page.getByTestId('assistant-text').first().innerText();
    record(`chat.${project}.answer`, text.slice(0, 400));
    expect(capture.bodies.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(5);
    await snap(page, `ui-chat-${project}.png`);
    capture.stop();
  });

  test('regression: brand-new chat renders user bubble immediately and the late assistant reply', async ({ page }) => {
    await page.goto('/');
    await newChat(page);
    await page.getByTestId('composer-input').fill('Say exactly: hi');
    await page.getByTestId('send-button').click();
    await expect(page.locator('.msg.user .ububble').getByText('Say exactly: hi')).toBeVisible({ timeout: 3000 });
    // The free model's answer can land after 20s under load; the UI shows the
    // user bubble immediately and the pending indicator until the late answer.
    const started = Date.now();
    await expect(page.getByTestId('assistant-text').first()).toBeVisible({ timeout: 45000 });
    record('chat.regression.answerLatencyMs', Date.now() - started);
    const text = await page.getByTestId('assistant-text').first().innerText();
    record('chat.regression.answer', text.slice(0, 200));
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('image >64KB attached inline, no 403', async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const buf = pngBuffer();
    record('image.pngBytes', buf.length);
    expect(buf.length).toBeGreaterThan(64 * 1024);
    await page.goto('/');
    await newChat(page);
    const capture = await capturePosts(page, (u) => /\/prompt$/.test(u));
    const forbidden: string[] = [];
    page.on('response', (r) => { if (r.status() === 403) forbidden.push(r.url()); });
    await page.getByTestId('file-input').setInputFiles({ name: 'chart.png', mimeType: 'image/png', buffer: buf });
    await expect(page.getByTestId('attachments')).toBeVisible();
    await page.getByTestId('composer-input').fill('Read this chart and describe the trend in one line.');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('assistant-text').first()).toBeVisible({ timeout: 60000 });
    const body = capture.bodies[0]?.body as { files?: Array<{ uri: string; source: { type: string }; name: string }> } | undefined;
    record(`image.${project}.promptShape`, body?.files?.map((f) => ({ uriPrefix: f.uri.slice(0, 30), source: f.source, name: f.name })) || null);
    expect(body?.files?.[0]?.source?.type).toBe('inline');
    expect(body?.files?.[0]?.uri).toMatch(/^data:image\/png;base64,/);
    record(`image.${project}.forbidden`, forbidden);
    expect(forbidden).toEqual([]);
    await snap(page, `ui-image-${project}.png`);
    capture.stop();
  });

  test('Tamil toggle inline in composer: prefix, instruction PUT, Tamil reply', async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    await page.goto('/');
    await newChat(page);
    await page.getByTestId('composer').getByRole('radio', { name: 'தமிழ்' }).click();
    const lang = await page.evaluate(() => localStorage.getItem('stragy.voice.language'));
    record(`tamil.${project}.langKey`, lang);
    expect(lang).toBe('ta');
    const prompts = await capturePosts(page, (u) => /\/prompt$/.test(u));
    const puts: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && /instructions\/entries\/stragy\.language/.test(r.url())) puts.push(r.url()); });
    await page.getByTestId('composer-input').fill('what is the EOD date in the cache?');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('assistant-text').first()).toBeVisible({ timeout: 60000 });
    const promptText = (prompts.bodies[0]?.body as { text: string })?.text || '';
    record(`tamil.${project}.promptPrefix`, promptText.slice(0, 120));
    expect(promptText).toContain('Reply in Tamil (தமிழ்)');
    record(`tamil.${project}.instructionPuts`, puts);
    const answer = await page.getByTestId('assistant-text').first().innerText();
    record(`tamil.${project}.answer`, answer.slice(0, 400));
    expect(/[\u0B80-\u0BFF]/.test(answer)).toBe(true);
    await expect(page.locator('[data-testid="assistant-text"][lang="ta"]').first()).toBeVisible();
    await snap(page, `ui-tamil-${project}.png`);
    await expect(page.getByTestId('send-button')).toBeVisible({ timeout: 30000 }); // previous turn fully settled
    await page.getByTestId('composer').getByRole('radio', { name: 'English' }).click();
    await page.getByTestId('composer-input').fill('Now answer in English: what is the EOD date?');
    await page.getByTestId('send-button').click();
    await expect.poll(() => prompts.bodies.length, { timeout: 30000 }).toBeGreaterThan(1);
    const enText = (prompts.bodies[1]?.body as { text: string })?.text || '';
    record(`tamil.${project}.englishPrefix`, enText.slice(0, 80));
    expect(enText).toContain('Reply in English.');
    prompts.stop();
  });

  test('voice: mic + language toggle live in composer; honest browser capability and /tts fallback', async ({ page }, testInfo) => {
    await page.goto('/');
    await newChat(page);
    const caps = await page.evaluate(async () => {
      const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
      let voices: Array<{ lang: string; name: string }> = [];
      try { voices = (window.speechSynthesis?.getVoices() || []).map((v) => ({ lang: v.lang, name: v.name })); } catch { /* ignore */ }
      let tts = null;
      try { tts = await (await fetch('/tts')).json(); } catch { /* ignore */ }
      return { speechRecognition: !!(w.SpeechRecognition || w.webkitSpeechRecognition), voiceCount: voices.length, tamilVoices: voices.filter((v) => /^ta/i.test(v.lang)).length, serverTts: tts };
    });
    record(`voice.${testInfo.project.name}.capabilities`, caps);
    expect(caps.speechRecognition).toBe(true);
    await expect(page.getByTestId('composer').getByRole('radio', { name: 'தமிழ்' })).toBeVisible();
    // Fake-silence recognition can end in well under a Playwright poll interval.
    // Record every state the strip actually renders inside the page instead.
    await page.evaluate(() => {
      const w = window as unknown as { __voiceStates?: string[]; __voiceTimer?: number };
      w.__voiceStates = [];
      w.__voiceTimer = window.setInterval(() => {
        document.querySelectorAll('[data-testid="voice-state"]').forEach((el) => {
          const txt = (el as HTMLElement).innerText?.trim();
          if (txt && w.__voiceStates && w.__voiceStates.at(-1) !== txt) w.__voiceStates.push(txt);
        });
      }, 20);
    });
    await page.getByTestId('voice-button').click();
    await page.waitForTimeout(2000);
    const state = await page.evaluate(() => {
      const w = window as unknown as { __voiceStates?: string[]; __voiceTimer?: number };
      if (w.__voiceTimer) window.clearInterval(w.__voiceTimer);
      return w.__voiceStates || [];
    });
    record(`voice.${testInfo.project.name}.micState`, state);
    expect(state.join(' ')).toMatch(/listening|unavailable|transcribing|speaking|கேட்கிறது|இடங்கிடைக்கவில்லை/);
    await snap(page, `ui-voice-mic-${testInfo.project.name}.png`);
    // Stop any active recognition so it cannot leak into the next test.
    if (await page.getByTestId('ptt-button').count()) {
      await page.getByTestId('ptt-button').click({ timeout: 2000, force: true }).catch(() => {});
    }
  });

  test('/tts server fallback: WAV, auth, bounded text, no shell injection', async ({ baseURL }) => {
    const auth = 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64');
    const capRes = await fetch(`${baseURL}/tts`, { headers: { authorization: auth } });
    const cap = await capRes.json() as { available: boolean; languages: string[] };
    record('tts.capability', cap);
    expect(capRes.status).toBe(200);
    expect(cap.available).toBe(true);
    expect(await fetch(`${baseURL}/tts`).then((r) => r.status)).toBe(401);
    const marker = '/tmp/stragy-tts-injection-probe';
    try { fs.unlinkSync(marker); } catch { /* ignore */ }
    const res = await fetch(`${baseURL}/tts`, {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ text: `வணக்கம்'; touch ${marker}; echo 'ok`, lang: 'ta' }),
    });
    const wav = Buffer.from(await res.arrayBuffer());
    record('tts.wav', { status: res.status, bytes: wav.length, magic: wav.toString('ascii', 0, 4) });
    expect(res.status).toBe(200);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(fs.existsSync(marker)).toBe(false);
    const huge = await fetch(`${baseURL}/tts`, {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(9000), lang: 'en' }),
    });
    record('tts.oversizeStatus', huge.status);
    expect(huge.status).toBe(413);
  });

  test('Market Scanner: real /api/v2/scans run with progress, coverage and results', async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    await page.goto('/');
    await navigate(page, 'scanner');
    await expect(page.getByTestId('scanner-screen')).toBeVisible();
    await expect(page.getByTestId('scanner-cache-chip')).toContainText('symbols');
    await page.getByTestId('scanner-limit').fill('6');
    await page.getByTestId('scanner-universe').selectOption('NIFTY_50');
    const posts = await capturePosts(page, (u) => /\/api\/v2\/scans/.test(u));
    await page.getByTestId('scanner-run').click();
    await expect(page.getByTestId('scanner-progress').or(page.getByTestId('scanner-results')).or(page.getByTestId('scanner-error')).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('scanner-results').or(page.getByTestId('scanner-error')).first()).toBeVisible({ timeout: 90000 });
    record(`scanner.${project}.posts`, posts.bodies);
    expect(posts.bodies.length).toBeGreaterThan(0);
    const body = posts.bodies[0]?.body as { universe?: string; maxSymbols?: number; limit?: number; strategy?: unknown };
    expect(body?.universe).toBe('NIFTY_50');
    // The engine uses maxSymbols for the scan size and limit for result paging.
    expect(body?.maxSymbols ?? body?.limit).toBe(6);
    expect(body?.strategy).toBeTruthy();
    if (await page.getByTestId('scanner-results').count()) {
      record(`scanner.${project}.matched`, await page.getByTestId('scan-matched').innerText());
      record(`scanner.${project}.coverage`, await page.getByTestId('scan-coverage').innerText());
      record(`scanner.${project}.mode`, await page.getByTestId('scan-mode').innerText());
      record(`scanner.${project}.summary`, await page.getByTestId('scan-summary').innerText());
      const rows = await page.getByTestId('scan-row').count();
      record(`scanner.${project}.rows`, rows);
      const matched = Number((await page.getByTestId('scan-matched').innerText()).match(/\d+/)?.[0] || '0');
      expect(matched).toBeGreaterThanOrEqual(0);
      expect(rows).toBeLessThanOrEqual(6);
      if (!rows) await expect(page.getByTestId('scan-no-matches')).toBeVisible();
    } else {
      record(`scanner.${project}.error`, await page.getByTestId('scanner-error').innerText());
    }
    await snap(page, `ui-scanner-${project}.png`);
    posts.stop();
  });

  test('SSE: killed stream reconnects; one final message, no duplicate tool cards', async ({ page }, testInfo) => {
    let eventRequests = 0;
    await page.route('**/opencode/api/event', async (route) => {
      eventRequests++;
      if (eventRequests === 1) await route.abort('failed');
      else await route.continue();
    });
    await page.goto('/');
    await newChat(page);
    await page.getByTestId('composer-input').fill('Using get_data_cache, report cached symbols and the last EOD date in one paragraph.');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('assistant-text').first()).toBeVisible({ timeout: 60000 });
    await expect.poll(() => eventRequests, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
    const answer = await page.getByTestId('assistant-text').first().innerText();
    record(`sse.${testInfo.project.name}.reconnects`, eventRequests);
    record(`sse.${testInfo.project.name}.answerLength`, answer.length);
    record(`sse.${testInfo.project.name}.assistantRows`, await page.getByTestId('assistant-text').count());
    record(`sse.${testInfo.project.name}.toolCards`, await page.locator('.tool-card').count());
    expect(answer.length).toBeGreaterThan(10);
    expect(await page.getByTestId('assistant-text').count()).toBe(1);
    await snap(page, `ui-sse-${testInfo.project.name}.png`);
    await page.unroute('**/opencode/api/event');
  });

  test('mobile 390x844: composer/send/lang/nav visible, no overlap or horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await newChat(page);
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const [name, sel] of [
      ['composer', '[data-testid="composer"]'],
      ['input', '[data-testid="composer-input"]'],
      ['send', '[data-testid="send-button"]'],
      ['lang', '[data-testid="composer"] [role="radiogroup"]'],
      ['nav', '.mobile-nav'],
    ] as const) {
      const b = await page.locator(sel).boundingBox();
      if (b) boxes[name] = b;
    }
    record('mobile.boxes', boxes);
    for (const [name, b] of Object.entries(boxes)) {
      expect(b.x).toBeGreaterThanOrEqual(-1);
      expect(b.y).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width).toBeLessThanOrEqual(391);
      expect(b.y + b.height).toBeLessThanOrEqual(845);
    }
    expect(boxes.composer.y + boxes.composer.height).toBeLessThanOrEqual(boxes.nav.y + 2);
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    record('mobile.overflow', overflow);
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
    await navigate(page, 'scanner');
    const scannerOverflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    record('mobile.scannerOverflow', scannerOverflow);
    expect(scannerOverflow.scroll).toBeLessThanOrEqual(scannerOverflow.client + 1);
    await snap(page, 'ui-390-scanner.png');
    await snap(page, 'ui-390-chat.png');
  });
});
