import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { db } from './db.js';
import { MockLineJudge, MockModeration, MockMusicProvider, MockSceneArtist, MockVoice } from './adapters/mock.js';
import { RoundEngine, type RoundEvent, type CandidateLine } from './round-engine.js';
import { TwitchService } from './twitch.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
app.use(express.json());
const oauthStates = new Map<string, number>();
const scopes = ['user:read:chat', 'user:write:chat', 'channel:read:redemptions', 'moderator:read:followers'];

function broadcast(event: RoundEvent): void {
  const data = JSON.stringify(event);
  for (const client of wss.clients) if (client.readyState === 1) client.send(data);
}

const saveSong = db.prepare(`INSERT INTO songs (id, channel_id, title, style, created_at, audio_url, duration_sec, lines_json)
  VALUES (@id, @channelId, @title, @style, @createdAt, @audioUrl, @durationSec, @linesJson)`);

const engine = new RoundEngine({
  writeSeconds: config.writeSeconds, voteSeconds: config.voteSeconds,
  roundsPerSong: config.roundsPerSong, maxSongsPerHour: config.maxSongsPerHour,
  channelId: 'local', channelLogin: config.twitchChannelLogin || 'local',
  judge: new MockLineJudge(), moderation: new MockModeration(), music: new MockMusicProvider(),
  artist: new MockSceneArtist(), voice: new MockVoice(), broadcast,
  saveSong: (song) => saveSong.run({
    id: song.id, channelId: song.channelId, title: song.title, style: song.style,
    createdAt: song.createdAt, audioUrl: song.clip.audioUrl, durationSec: song.clip.durationSec,
    linesJson: JSON.stringify(song.lines),
  }),
});
const twitch = new TwitchService(engine);

app.get('/', (_req, res) => res.redirect('/dashboard'));
app.get('/dashboard', (_req, res) => res.sendFile(resolve('public/dashboard.html')));
app.get('/overlay', (_req, res) => res.sendFile(resolve('public/overlay.html')));
app.get('/api/state', (_req, res) => res.json(engine.snapshot()));
app.get('/api/config', (_req, res) => res.json({ writeSeconds: config.writeSeconds, voteSeconds: config.voteSeconds, roundsPerSong: config.roundsPerSong }));
app.get('/api/twitch/status', (_req, res) => {
  const account = db.prepare('SELECT user_id AS id, login FROM twitch_tokens ORDER BY updated_at DESC LIMIT 1').get() as { id: string; login: string } | undefined;
  res.json({ connected: Boolean(account), account: account?.login ?? null });
});
app.post('/api/twitch/connect', async (_req, res) => {
  try { await twitch.start(); res.json({ connected: true }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to connect EventSub' }); }
});
app.post('/api/twitch/disconnect', (_req, res) => { twitch.stop(); res.json({ connected: false }); });
app.post('/api/start', async (req, res) => {
  try { await engine.start(req.body.style, req.body.mood); res.json(engine.snapshot()); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to start' }); }
});
app.post('/api/stop', (_req, res) => { engine.stop(); res.json(engine.snapshot()); });
app.post('/api/simulate', async (req, res) => {
  const { login = 'viewer', text = '' } = req.body as { login?: string; text?: string };
  let accepted = false;
  if (text === '!force-write-end') { await engine.finishWrite(); accepted = true; }
  else if (text === '!force-vote-end') { await engine.finishVote(); accepted = true; }
  else if (text === '!force-play-end') { await engine.finishPlay(); accepted = true; }
  else if (/^![1-4]$/.test(text)) accepted = engine.vote(login, Number(text.slice(1)) - 1);
  else if (text.toLowerCase().startsWith('!line ')) {
    const line: CandidateLine = { text: text.slice(6), login, userId: login.toLowerCase() };
    accepted = await engine.submitLine(line);
  }
  res.json({ accepted, state: engine.snapshot() });
});
app.get('/api/songs', (_req, res) => {
  const songs = db.prepare('SELECT id, channel_id AS channelId, title, style, created_at AS createdAt, duration_sec AS durationSec, lines_json AS linesJson FROM songs ORDER BY created_at DESC LIMIT 50').all() as Array<Record<string, unknown>>;
  res.json(songs.map((song) => ({ ...song, lines: JSON.parse(String(song.linesJson)) })));
});
app.get('/auth/login', (_req, res) => {
  if (!config.twitchClientId || !config.twitchClientSecret) return res.status(503).send('Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env first.');
  const state = randomBytes(24).toString('hex');
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('client_id', config.twitchClientId); url.searchParams.set('redirect_uri', config.twitchRedirectUri);
  url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', scopes.join(' ')); url.searchParams.set('state', state);
  res.redirect(url.toString());
});
app.get('/auth/callback', async (req, res) => {
  const state = String(req.query.state ?? '');
  const expiresAt = oauthStates.get(state);
  oauthStates.delete(state);
  if (!state || !expiresAt || expiresAt < Date.now()) return res.status(400).send('OAuth state is invalid or expired. Restart from /auth/login.');
  if (req.query.error) return res.status(400).send(`Twitch authorization failed: ${String(req.query.error_description ?? req.query.error)}`);
  try {
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.twitchClientId, client_secret: config.twitchClientSecret, code: String(req.query.code ?? ''), grant_type: 'authorization_code', redirect_uri: config.twitchRedirectUri }) });
    if (!tokenResponse.ok) return res.status(502).send(`Twitch token exchange failed (${tokenResponse.status}).`);
    const token = await tokenResponse.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string[] };
    const userResponse = await fetch('https://api.twitch.tv/helix/users', { headers: { 'Client-Id': config.twitchClientId, Authorization: `Bearer ${token.access_token}` } });
    if (!userResponse.ok) return res.status(502).send('Twitch user lookup failed.');
    const userData = await userResponse.json() as { data: Array<{ id: string; login: string }> };
    const user = userData.data[0];
    if (!user) return res.status(502).send('Twitch did not return an account.');
    db.prepare(`INSERT INTO twitch_tokens (user_id, login, access_token, refresh_token, expires_at, scopes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET login=excluded.login, access_token=excluded.access_token, refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, scopes=excluded.scopes, updated_at=excluded.updated_at`)
      .run(user.id, user.login, token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000, JSON.stringify(token.scope), Date.now());
    res.send(`Connected Twitch account @${user.login}. EventSub listener will start when chat integration is enabled.`);
  } catch (error) { res.status(502).send(error instanceof Error ? error.message : 'Twitch connection failed.'); }
});
app.get('/song/:id', (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song) return res.status(404).send('Song not found');
  res.type('html').send(`<main style="font:20px system-ui;max-width:800px;margin:10vh auto"><h1>${String((song as { title: string }).title)}</h1><p>Style: ${String((song as { style: string }).style)}</p><pre>${String((song as { lines_json: string }).lines_json)}</pre><audio controls src="${String((song as { audio_url: string }).audio_url)}"></audio></main>`);
});
app.get('/media/mock-tone.wav', (_req, res) => {
  const sampleRate = 22050;
  const duration = Math.min(60, Math.max(1, Number(_req.query.duration) || 8));
  const samples = Math.floor(sampleRate * duration);
  const dataBytes = samples * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const beat = (t % 0.5) < 0.035 ? 0.35 : 0;
    const tone = Math.sin(2 * Math.PI * 220 * t) * 0.035 + Math.sin(2 * Math.PI * 110 * t) * 0.055 + beat;
    const envelope = Math.min(1, t * 12, (duration - t) * 12);
    wav.writeInt16LE(Math.max(-1, Math.min(1, tone * envelope)) * 32767, 44 + i * 2);
  }
  res.type('audio/wav').send(wav);
});

const staticRoot = resolve('public');
app.use(express.static(staticRoot));
app.get('/api/health', (_req, res) => res.json({ ok: true, phase: engine.snapshot().phase }));

server.listen(config.port, () => console.log(`Verse vs Verse ready at http://localhost:${config.port}`));

process.on('SIGINT', () => { engine.stop(); twitch.stop(); db.close(); server.close(() => process.exit(0)); });
