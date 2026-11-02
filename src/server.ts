import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { db } from './db.js';
import { OpenCompatibleJudge, PascalProvider, RealModeration, LlmSceneArtist } from './adapters/real.js';
import { RoundEngine, type RoundEvent, type RoundState, type CandidateLine } from './round-engine.js';
import { TwitchService } from './twitch.js';
import { buildVideoTimeline, queueMusicVideoExport } from './video-export.js';
import { access, rm } from 'node:fs/promises';
import { getSceneForLine, sceneKeyForLine } from './scene-index.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
app.use(express.json());
const oauthStates = new Map<string, number>();
const scopes = ['user:read:chat', 'user:write:chat', 'channel:read:redemptions', 'moderator:read:followers'];
function normalizeLine(text: string): string { return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

let lastPhase = 'IDLE';
let twitchRef: TwitchService | null = null;
// one chat message per phase change, instead of a reply to every line and vote
// on a tie the line the AI judge ranked higher (the lower number) wins; say so instead of looking random
function tieNote(votes: number[]): string {
  const top = Math.max(0, ...votes);
  return top > 0 && votes.filter((count) => count === top).length > 1 ? 'Tie! It goes to the AI judge\'s pick. ' : top === 0 ? 'No votes, so the AI judge picked. ' : '';
}
function announce(state: RoundState): void {
  if (state.phase === lastPhase) return;
  lastPhase = state.phase;
  const winner = state.song.at(-1);
  const text = state.phase === 'WRITE' ? `Round ${state.round}/${state.roundsPerSong}: write the next line! Type !line <your lyric> (${state.writeSeconds}s)`
    // list the options in chat too: viewers reading chat (or on mobile) can't see the overlay's numbering
    : state.phase === 'VOTE' ? `Vote for the next line (${state.voteSeconds}s): ${state.shortlist.map((line, index) => `!${index + 1} "${line.text}"`).join(' | ')}`
    : state.phase === 'PLAY' && winner && state.clip ? `${tieNote(state.votes)}Line ${state.song.length} by @${winner.login} won (${Math.max(0, ...state.votes)} vote${Math.max(0, ...state.votes) === 1 ? '' : 's'}). Listen!`
    : '';
  if (text && twitchRef?.connected()) void twitchRef.sendChat(text);
}

function broadcast(event: RoundEvent): void {
  if (event.type === 'STATE') announce(event.state);
  if (event.type === 'MUSIC_FAILED' && twitchRef?.connected()) void twitchRef.sendChat(event.message);
  if (event.type === 'SAVED' && twitchRef?.connected()) void twitchRef.sendChat(`The song is done: "${engine.snapshot().title}". Thanks for writing it, chat!`);
  const data = JSON.stringify(event);
  for (const client of wss.clients) if (client.readyState === 1) client.send(data);
}

await rm(resolve('data/video-work'), { recursive: true, force: true });
db.prepare("UPDATE songs SET video_status='failed', video_error='Server restarted while export was rendering' WHERE video_status='rendering'").run();

const saveSong = db.prepare(`INSERT INTO songs (id, channel_id, title, style, created_at, audio_url, duration_sec, lines_json, video_status, fidelity_score, release_status, release_error)
  VALUES (@id, @channelId, @title, @style, @createdAt, @audioUrl, @durationSec, @linesJson, @videoStatus, @fidelityScore, 'ready', NULL)
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,style=excluded.style,created_at=excluded.created_at,audio_url=excluded.audio_url,duration_sec=excluded.duration_sec,lines_json=excluded.lines_json,video_status=excluded.video_status,fidelity_score=excluded.fidelity_score,release_status='ready',release_error=NULL`);

const engine = new RoundEngine({
  writeSeconds: config.writeSeconds, voteSeconds: config.voteSeconds,
  roundsPerSong: config.roundsPerSong, maxSongsPerHour: config.maxSongsPerHour, releaseSeconds: config.releaseSeconds,
  channelId: 'local', channelLogin: config.twitchChannelLogin || 'local',
  judge: new OpenCompatibleJudge(), moderation: new RealModeration(), music: new PascalProvider(),
  artist: new LlmSceneArtist(), voice: new PascalProvider(), broadcast,
  saveSong: (song) => saveSong.run({
    id: song.id, channelId: song.channelId, title: song.title, style: song.style,
    createdAt: song.createdAt, audioUrl: song.clip.audioUrl, durationSec: song.clip.durationSec,
    linesJson: JSON.stringify(song.lines),
    videoStatus: 'pending',
    fidelityScore: song.clip.fidelityScore ?? null,
  }),
  onLoopLimit: () => { if(twitch.connected()) void twitch.sendChat('Hourly song limit reached. Loop mode will resume when a slot opens.'); },
  onReleaseFailure: (song) => {
    db.prepare(`INSERT INTO songs (id,channel_id,title,style,created_at,audio_url,duration_sec,lines_json,video_status,fidelity_score,release_status,release_error) VALUES (?,?,?,?,?,?,0,?,'failed',NULL,'failed',?) ON CONFLICT(id) DO UPDATE SET release_status='failed',release_error=excluded.release_error`).run(song.id,song.channelId,song.title,song.style,song.createdAt,'',JSON.stringify(song.lines),song.error);
  },
  saveScene: (line, scene) => db.prepare('INSERT INTO scenes (id, line, scene_json, created_at) VALUES (?, ?, ?, ?)').run(randomBytes(12).toString('hex'), line, JSON.stringify(scene), Date.now()),
  onRelease: async (song) => {
    const audioPath = !song.clip.isMock && song.clip.audioUrl.startsWith('/media/') && !song.clip.audioUrl.includes('mock-tone') ? resolve('data/media', song.clip.audioUrl.slice('/media/'.length).split('?')[0]) : null;
    if (!audioPath) {
      db.prepare("UPDATE songs SET video_status='failed',video_error='No saved audio file is available for video export' WHERE id=?").run(song.id);
      return;
    }
    try{await access(audioPath);}catch{db.prepare("UPDATE songs SET video_status='failed',video_error='Saved real audio file is missing' WHERE id=?").run(song.id);return;}
    const unassigned = [...(song.clip.lineTimings ?? [])];
    const lineTimings = song.lines.map((line, index) => {
      const match = unassigned.findIndex((timing) => normalizeLine(timing.text) === normalizeLine(line.text));
      return match >= 0 ? unassigned.splice(match, 1)[0]! : { text: line.text, start: song.clip.durationSec * index / Math.max(song.lines.length,1), end: song.clip.durationSec * (index + 1) / Math.max(song.lines.length,1) };
    });
    const chatScenes = await Promise.all(song.lines.map(async (line, lineIndex) => {
      const timing = lineTimings[lineIndex]!;
      let scene = getSceneForLine(song.scenes, line);
      if (!scene) {
        scene = await new LlmSceneArtist().create(line, song.lines, song.mood);
        db.prepare('INSERT INTO scenes (id, line, scene_json, created_at) VALUES (?, ?, ?, ?)').run(randomBytes(12).toString('hex'), line.text, JSON.stringify(scene), Date.now());
      }
      return { lineKey: sceneKeyForLine(line), scene, line, channelName: config.twitchChannelLogin || undefined, start: timing.start, end: timing.end, words: song.clip.words.filter((word) => word.start >= timing.start && word.start < timing.end) };
    }));
    const sungSegments=song.clip.sungSegments?.length?song.clip.sungSegments:lineTimings;
    const videoScenes=buildVideoTimeline(sungSegments,chatScenes,song.clip.durationSec);
    void queueMusicVideoExport(song.id, song.title, audioPath, song.clip.durationSec, videoScenes, () => {
      db.prepare("UPDATE songs SET video_status='rendering',video_error=NULL WHERE id=?").run(song.id);
    }, (error) => {
      const reason=error instanceof Error?error.message:String(error);
      db.prepare("UPDATE songs SET video_status='failed',video_error=? WHERE id=?").run(reason.slice(0,1000), song.id);
    }).then((videoUrl) => {
      db.prepare("UPDATE songs SET video_url=?, video_status='ready',video_error=NULL WHERE id=?").run(videoUrl, song.id);
      void twitch.sendChat(`Music video is ready: http://localhost:${config.port}/song/${song.id}`);
    }).catch((error) => { console.error('[Music video export]', error); });
  },
});
const twitch = new TwitchService(engine);
twitchRef = twitch;
// listen to chat straight away if an account was connected before (no manual "Start EventSub" after a restart)
const hasToken = () => Boolean(db.prepare('SELECT 1 FROM twitch_tokens LIMIT 1').get());
if (hasToken()) void twitch.start().catch((error) => console.error('EventSub autostart failed:', error.message));

app.get('/', (_req, res) => res.redirect('/dashboard'));
app.get('/dashboard', (_req, res) => res.sendFile(resolve('public/dashboard.html')));
app.get('/overlay', (_req, res) => res.sendFile(resolve('public/overlay.html')));
app.get('/api/state', (_req, res) => res.json(engine.snapshot()));
app.get('/api/scenes', (_req, res) => res.json(db.prepare('SELECT line, scene_json FROM scenes ORDER BY created_at DESC LIMIT 20').all().map((raw) => { const row=raw as {line:string;scene_json:string};return {...JSON.parse(row.scene_json),line:row.line}; })));
app.post('/api/preview', async (req, res) => {
  const text = String(req.body.line ?? '').slice(0, 80); const mood = String(req.body.mood ?? 'day');
  if (!text.trim()) return res.status(400).json({ error: 'Enter a lyric line.' });
  try {
    const line = { text, login: 'preview', userId: 'preview' };
    const scene = await new LlmSceneArtist().create(line, [], mood);
    db.prepare('INSERT INTO scenes (id, line, scene_json, created_at) VALUES (?, ?, ?, ?)').run(randomBytes(12).toString('hex'), text, JSON.stringify(scene), Date.now());
    scene.line = text;
    res.json({ scene });
  } catch { res.status(500).json({ error: 'Could not create preview.' }); }
});
app.get('/preview', (_req, res) => res.sendFile(resolve('public/preview.html')));
app.get('/api/config', (_req, res) => res.json(engine.settings()));
app.post('/api/settings', (req,res)=>res.json(engine.updateSettings({writeSeconds:Number(req.body.writeSeconds),voteSeconds:Number(req.body.voteSeconds),roundsPerSong:Number(req.body.roundsPerSong),loopMode:Boolean(req.body.loopMode)})));
app.post('/api/retry-release', async (_req,res)=>{const retried=await engine.retryRelease();res.status(retried?200:409).json({retried,state:engine.snapshot()});});
app.get('/api/twitch/status', (_req, res) => {
  const account = db.prepare("SELECT user_id AS id, login FROM twitch_tokens WHERE user_id NOT LIKE 'demo-actor:%' ORDER BY updated_at DESC LIMIT 1").get() as { id: string; login: string } | undefined;
  res.json({ connected: Boolean(account), account: account?.login ?? null, eventSub: twitch.connected() });
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
  const songs = db.prepare('SELECT id, channel_id AS channelId, title, style, created_at AS createdAt, duration_sec AS durationSec, audio_url AS audioUrl, video_url AS videoUrl, video_status AS videoStatus, release_status AS releaseStatus, release_error AS releaseError, fidelity_score AS fidelityScore, lines_json AS linesJson FROM songs ORDER BY created_at DESC LIMIT 50').all() as Array<Record<string, unknown>>;
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
    void twitch.start().catch((error) => console.error('EventSub start failed:', error.message));
    res.send(`Connected Twitch account @${user.login}. Listening to chat now. <a href="/dashboard">Back to the dashboard</a>`);
  } catch (error) { res.status(502).send(error instanceof Error ? error.message : 'Twitch connection failed.'); }
});
app.get('/song/:id', (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id) as { id: string; title: string; style: string; audio_url: string; video_url: string | null; video_status: string; release_status: string; release_error:string|null; lines_json: string } | undefined;
  if (!song) return res.status(404).send('Song not found');
  const lines = JSON.parse(song.lines_json) as CandidateLine[];
  const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
  const player = song.release_status==='failed' ? `<p>Release failed: ${escape(song.release_error??'Unknown render error')}. Retry it from the <a href="/dashboard">dashboard</a>.</p>` : song.video_url ? `<video controls playsinline src="${escape(song.video_url)}"></video><p><a download href="${escape(song.video_url)}">Download music video</a></p>` : `<p>Music video: ${escape(song.video_status)}</p><audio controls src="${escape(song.audio_url)}"></audio><script>setTimeout(()=>location.reload(),5000)</script>`;
  res.type('html').send(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(song.title)}</title><style>body{font:18px system-ui;background:#17141a;color:#fffaf0;max-width:1000px;margin:4rem auto;padding:1rem}video{width:100%;border-radius:14px}li{margin:.7em 0}a{color:#7fd1c7}</style><h1>${escape(song.title)}</h1><p>${escape(song.style)} · <a href="/overlay">Verse vs Verse</a></p>${player}<h2>Lyrics & credits</h2><ol>${lines.map((line) => `<li>${escape(line.text)} <small>— @${escape(line.login)}</small></li>`).join('')}</ol></html>`);
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

app.get('/media/:file', (req, res) => {
  const file = String(req.params.file);
  if (!/^[a-f0-9-]+\.(wav|mp3|audio|mp4)$/i.test(file)) return res.sendStatus(404);
  res.sendFile(resolve('data/media', file));
});

const staticRoot = resolve('public');
app.use(express.static(staticRoot));
app.get('/api/health', (_req, res) => res.json({ ok: true, phase: engine.snapshot().phase }));

server.listen(config.port, () => console.log(`Verse vs Verse ready at http://localhost:${config.port}`));

// a background job (video export, a provider call) must never take the live show down
process.on('unhandledRejection', (error) => console.error('[unhandled]', error instanceof Error ? error.message : error));
process.on('SIGINT', () => { engine.stop(); twitch.stop(); db.close(); server.close(() => process.exit(0)); });
