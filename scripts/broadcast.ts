// Go live without OBS: render the overlay in headless Chrome, mix in each song clip exactly when it plays,
// and stream to the connected broadcaster's Twitch channel. A copy of exactly what went out is saved locally.
//   npm run broadcast            -> stream + local copy in data/broadcast/
//   npm run broadcast -- --local -> local recording only (no Twitch)
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';
import { db } from '../src/db.js';
import { config } from '../src/config.js';

const FPS = 24, RATE = 44100, CH = 2, W = 1280, H = 720;
const localOnly = process.argv.includes('--local');
const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg';
const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = `http://localhost:${config.port}`;
const require = createRequire(import.meta.url);
const CDP = require('chrome-remote-interface');

async function streamKey(): Promise<string> {
  const row = db.prepare("SELECT user_id, access_token FROM twitch_tokens WHERE user_id NOT LIKE 'demo-actor:%' ORDER BY updated_at DESC LIMIT 1").get() as { user_id: string; access_token: string } | undefined;
  if (!row) throw new Error('Connect the broadcaster account at /auth/login first.');
  const response = await fetch(`https://api.twitch.tv/helix/streams/key?broadcaster_id=${row.user_id}`, { headers: { 'Client-Id': config.twitchClientId, Authorization: `Bearer ${row.access_token}` } });
  const key = ((await response.json()) as { data?: Array<{ stream_key: string }> }).data?.[0]?.stream_key;
  if (!key) throw new Error(`Could not read the stream key (${response.status}). Re-authorize at /auth/login to grant channel:read:stream_key.`);
  return key;
}

// decode a clip to raw PCM so it can be mixed into the live audio track
function decode(url: string): Promise<Buffer> {
  const file = resolve('data/media', url.replace(/^\/media\//, '').split('?')[0]!);
  return new Promise((ok, fail) => {
    const p = spawn(ffmpegPath, ['-v', 'error', '-i', file, '-f', 's16le', '-ac', String(CH), '-ar', String(RATE), 'pipe:1']);
    const chunks: Buffer[] = []; p.stdout.on('data', (c) => chunks.push(c)); p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok(Buffer.concat(chunks)) : fail(new Error(`ffmpeg decode exited ${code}`))));
  });
}

async function main(): Promise<void> {
  const outDir = resolve('data/broadcast'); await mkdir(outDir, { recursive: true });
  const localFile = resolve(outDir, `broadcast-${new Date().toISOString().replace(/[:.]/g, '-')}.ts`);
  const targets = localOnly ? `[f=mpegts]${localFile.replace(/\\/g, '/')}` : `[f=flv:onfail=ignore]rtmp://live.twitch.tv/app/${await streamKey()}|[f=mpegts]${localFile.replace(/\\/g, '/')}`;

  // audio goes in over a local TCP socket, video over stdin; both are paced by the same clock below
  const audioPort = 41000 + Math.floor(Math.random() * 1000);
  // ffmpeg opens inputs in order: the audio socket must come first, or it blocks on stdin before ever listening
  const ff = spawn(ffmpegPath, ['-v', 'warning', '-thread_queue_size', '1024', '-f', 's16le', '-ar', String(RATE), '-ac', String(CH), '-i', `tcp://127.0.0.1:${audioPort}?listen=1`,
    '-thread_queue_size', '1024', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-map', '1:v', '-map', '0:a', '-vf', `scale=${W}:${H},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-b:v', '3000k', '-maxrate', '3000k', '-bufsize', '6000k', '-g', String(FPS * 2), '-keyint_min', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', String(RATE), '-flags', '+global_header', '-f', 'tee', targets], { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.on('exit', (code) => { console.log(`[broadcast] ffmpeg exited (${code})`); process.exit(code ?? 0); });
  const audio = await new Promise<net.Socket>((ok) => { const tryConnect = () => { const s = net.connect(audioPort, '127.0.0.1', () => ok(s)); s.on('error', () => setTimeout(tryConnect, 200)); }; tryConnect(); });

  // headless Chrome renders the real OBS overlay page (muted: we mix the audio ourselves)
  const chrome = spawn(chromePath, ['--headless=new', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=9333', `--user-data-dir=${resolve(outDir, 'chrome-profile')}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  let client: any; for (let i = 0; i < 50 && !client; i++) { try { client = await CDP({ port: 9333 }); } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const { Page, Emulation, Runtime } = client;
  await Promise.all([Page.enable(), Runtime.enable(), Emulation.setDeviceMetricsOverride({ width: W, height: H, deviceScaleFactor: 1, mobile: false })]);
  await Page.navigate({ url: `${base}/overlay` }); await Page.loadEventFired();
  // the overlay is transparent for OBS; give the stream a backdrop of its own
  await Runtime.evaluate({ expression: `document.documentElement.style.background='radial-gradient(ellipse at 30% 30%,#3a3150 0,#1b1722 60%,#120f17 100%)';document.body.style.background='transparent';` });
  let latest: Buffer | null = null;
  Page.screencastFrame(({ data, sessionId }: { data: string; sessionId: number }) => { latest = Buffer.from(data, 'base64'); void Page.screencastFrameAck({ sessionId }); });
  await Page.startScreencast({ format: 'jpeg', quality: 80, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  setInterval(() => { void Page.captureScreenshot({ format: 'jpeg', quality: 80 }).then((s: { data: string }) => { latest = Buffer.from(s.data, 'base64'); }).catch(() => undefined); }, 1000); // keep frames coming when nothing moves

  // follow the app: play each clip when the overlay does, stop when the phase leaves playback
  let clip: Buffer | null = null, clipPos = 0, phase = 'IDLE';
  const ws = new WebSocket(`ws://localhost:${config.port}/ws`);
  ws.on('message', async (raw) => {
    const event = JSON.parse(String(raw));
    if (event.type === 'STATE') { phase = event.state.phase; if (!['PLAY', 'RELEASE'].includes(phase)) clip = null; }
    if (event.type === 'CLIP' && !String(event.clip.audioUrl).includes('mock-tone')) { try { clip = await decode(event.clip.audioUrl); clipPos = 0; console.log(`[broadcast] playing ${event.clip.audioUrl}`); } catch (error) { console.error('[broadcast] decode failed', error); } }
  });

  // one clock drives both tracks so they never drift apart
  const start = process.hrtime.bigint(); let framesSent = 0, samplesSent = 0;
  const frameBytes = (n: number) => n * CH * 2;
  setInterval(() => {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
    for (const due = Math.floor(elapsed * FPS); framesSent < due && latest; framesSent++) ff.stdin.write(latest);
    const dueSamples = Math.floor(elapsed * RATE), n = dueSamples - samplesSent;
    if (n > 0) {
      const chunk = Buffer.alloc(frameBytes(n));
      if (clip) { const take = Math.min(chunk.length, clip.length - clipPos); clip.copy(chunk, 0, clipPos, clipPos + take); clipPos += take; if (clipPos >= clip.length) clip = null; }
      audio.write(chunk); samplesSent = dueSamples;
    }
  }, 20);
  console.log(`[broadcast] ${localOnly ? 'recording locally' : 'LIVE on twitch.tv/' + (config.twitchChannelLogin || 'your channel')} · saving ${localFile}`);
  const stop = () => { console.log('[broadcast] stopping'); ff.stdin.end(); audio.end(); chrome.kill(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const minutes = Number(process.env.BROADCAST_MINUTES ?? 0); if (minutes > 0) setTimeout(stop, minutes * 60_000);
}
main().catch((error) => { console.error('[broadcast]', error instanceof Error ? error.message : error); process.exit(1); });
