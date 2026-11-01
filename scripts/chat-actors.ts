import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { db } from '../src/db.js';
import { config } from '../src/config.js';
import type { Phase } from '../src/round-engine.js';
import WebSocket from 'ws';

type DemoMessage = { phase: Phase; round: number; at: number; text: string };
type ActorToken = { access_token: string; refresh_token: string; expires_at: number; user_id: string; twitch_id: string; login: string };

async function actorToken(): Promise<ActorToken> {
  const existing = db.prepare("SELECT * FROM twitch_tokens WHERE user_id LIKE 'demo-actor:%' LIMIT 1").get() as ActorToken | undefined;
  if (existing && existing.expires_at > Date.now() + 60_000) return existing;
  if (existing?.refresh_token) {
    const refreshed = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: existing.refresh_token, client_id: config.twitchClientId, client_secret: config.twitchClientSecret }) });
    if (refreshed.ok) {
      const data = await refreshed.json() as { access_token: string; refresh_token: string; expires_in: number };
      const next = { ...existing, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 };
      persist(next); return next;
    }
  }
  const initiated = await fetch('https://id.twitch.tv/oauth2/device', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.twitchClientId, scopes: 'user:write:chat' }) });
  if (!initiated.ok) throw new Error(`Twitch device flow failed (${initiated.status}): ${await initiated.text()}`);
  const device = await initiated.json() as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
  console.log(`Sign in the demo actor account: ${device.verification_uri} (code ${device.user_code})`);
  const end = Date.now() + device.expires_in * 1000;
  while (Date.now() < end) {
    await sleep(device.interval * 1000);
    const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.twitchClientId, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    if (response.status === 400) { const detail = await response.json() as { message?: string }; if (/authorization_pending|slow_down/i.test(detail.message ?? '')) continue; }
    if (!response.ok) throw new Error(`Device token exchange failed (${response.status}): ${await response.text()}`);
    const token = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
    const userRes = await fetch('https://api.twitch.tv/helix/users', { headers: { 'Client-Id': config.twitchClientId, Authorization: `Bearer ${token.access_token}` } });
    if (!userRes.ok) throw new Error(`Actor profile lookup failed (${userRes.status})`);
    const user = (await userRes.json() as { data: Array<{ id: string; login: string }> }).data[0];
    if (!user) throw new Error('Twitch returned no actor profile');
    const actor = { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: Date.now() + token.expires_in * 1000, user_id: `demo-actor:${user.id}`, twitch_id: user.id, login: user.login };
    persist(actor); console.log(`Demo actor connected as @${user.login}`); return actor;
  }
  throw new Error('Device code expired before authorization completed');
}

function persist(actor: ActorToken): void {
  db.prepare(`INSERT INTO twitch_tokens (user_id, login, access_token, refresh_token, expires_at, scopes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET login=excluded.login, access_token=excluded.access_token, refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, scopes=excluded.scopes, updated_at=excluded.updated_at`)
    .run(actor.user_id, actor.login, actor.access_token, actor.refresh_token, actor.expires_at, JSON.stringify(['user:write:chat']), Date.now());
}

async function main(): Promise<void> {
  if (!config.twitchClientId || !config.twitchClientSecret || !config.twitchChannelLogin) throw new Error('Set Twitch app credentials and TWITCH_CHANNEL_LOGIN before running chat actors.');
  const actor = await actorToken();
  const broadcasterRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(config.twitchChannelLogin)}`, { headers: { 'Client-Id': config.twitchClientId, Authorization: `Bearer ${actor.access_token}` } });
  if (!broadcasterRes.ok) throw new Error(`Channel lookup failed (${broadcasterRes.status})`);
  const broadcaster = (await broadcasterRes.json() as { data: Array<{ id: string }> }).data[0];
  if (!broadcaster) throw new Error(`Channel ${config.twitchChannelLogin} not found`);
  const send = async (text: string) => {
    const response = await fetch('https://api.twitch.tv/helix/chat/messages', { method: 'POST', headers: { 'Client-Id': config.twitchClientId, Authorization: `Bearer ${actor.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ broadcaster_id: broadcaster.id, sender_id: actor.twitch_id, message: text.slice(0, 500) }) });
    if (!response.ok) throw new Error(`Chat send failed (${response.status}): ${await response.text()}`);
  };
  const script = JSON.parse(await readFile(config.demoScriptPath, 'utf8')) as DemoMessage[];
  const ws = new WebSocket(`ws://localhost:${config.port}/ws`);
  let phase: Phase | null = null; let round = 0; let phaseStarted = Date.now();
  let pending = script.slice();
  ws.on('message', async (raw) => {
    const event = JSON.parse(raw.toString()) as { type: string; state?: { phase: Phase; round: number } };
    if (event.type !== 'STATE' || !event.state) return;
    const nextPhase = event.state.phase; const nextRound = event.state.round;
    if (phase !== nextPhase || round !== nextRound) {
      phase = nextPhase; round = nextRound; phaseStarted = Date.now();
      const scheduled = pending.filter((entry) => entry.phase === phase && entry.round === round).sort((a, b) => a.at - b.at);
      pending = pending.filter((entry) => !(entry.phase === phase && entry.round === round));
      for (const entry of scheduled) {
        const delay = Math.max(0, phaseStarted + entry.at * 1000 - Date.now());
        const phaseDeadline = phase === 'WRITE' ? config.writeSeconds * 1000 : phase === 'VOTE' ? config.voteSeconds * 1000 : Infinity;
        if (entry.at * 1000 >= phaseDeadline) { console.warn(`Skipping out-of-phase script message: ${entry.text}`); continue; }
        await sleep(Math.min(delay, phaseDeadline));
        if (Date.now() >= phaseStarted + phaseDeadline) { console.warn(`Skipping late script message: ${entry.text}`); continue; }
        await send(entry.text);
        console.log(`[${phase} ${round} +${entry.at}s] ${entry.text}`);
        await sleep(1200); // conservative spacing under chat message rate limits
      }
    }
  });
  ws.on('open', () => console.log(`Playing ${script.length} scripted messages into #${config.twitchChannelLogin}; Ctrl+C to stop.`));
  ws.on('error', (error) => console.error('Local WebSocket error:', error.message));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
