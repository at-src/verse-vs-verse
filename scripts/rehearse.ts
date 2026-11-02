// Rehearsal mode: run a planned song through real Twitch chat. Each connected account (the broadcaster and any
// rehearsal accounts added at /auth/login?actor=1) posts its planned lines and votes through Twitch's chat API,
// and the app reacts exactly as it would to any viewer.
//   npm run rehearse -- demo-scripts/demo-song.json
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { db } from '../src/db.js';
import { config } from '../src/config.js';
import { allTokens } from './tokens.js';

type Plan = { style: string; mood: string; settings?: Record<string, unknown>; opener?: Array<{ from: string; text: string }>;
  rounds: Array<{ lines: Record<string, string>; vote: string }> }; // vote = whose line every account votes for
type Account = { id: string; login: string; token: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = `http://localhost:${config.port}`;
const api = async (path: string, body?: unknown) => (await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json() as Promise<any>;

async function accounts(): Promise<{ broadcaster: Account; byLogin: Map<string, Account> }> {
  const rows = await allTokens();
  const list = rows.map((row) => ({ id: row.user_id.replace(/^demo-actor:/, ''), login: row.login.toLowerCase(), token: row.access_token, actor: row.user_id.startsWith('demo-actor:') }));
  const broadcaster = list.find((item) => !item.actor);
  if (!broadcaster) throw new Error('Connect the broadcaster at /auth/login first.');
  return { broadcaster, byLogin: new Map(list.map((item) => [item.login, item])) };
}

async function say(from: Account, broadcaster: Account, text: string): Promise<void> {
  const response = await fetch('https://api.twitch.tv/helix/chat/messages', { method: 'POST', headers: { 'Client-Id': config.twitchClientId, Authorization: `Bearer ${from.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ broadcaster_id: broadcaster.id, sender_id: from.id, message: text }) });
  const result = await response.json().catch(() => ({})) as any;
  const sent = result.data?.[0];
  console.log(`  @${from.login}: ${text}${response.ok && sent?.is_sent !== false ? '' : `  [NOT SENT ${response.status} ${sent?.drop_reason?.message ?? JSON.stringify(result).slice(0, 120)}]`}`);
}

async function main(): Promise<void> {
  const plan = JSON.parse(await readFile(process.argv[2] ?? 'demo-scripts/demo-song.json', 'utf8')) as Plan;
  const { broadcaster, byLogin } = await accounts();
  const who = (login: string) => { const account = byLogin.get(login.toLowerCase()); if (!account) throw new Error(`@${login} is not connected (add it at ${base}/auth/login?actor=1)`); return account; };
  for (const round of plan.rounds) for (const login of [...Object.keys(round.lines), round.vote]) who(login);

  let state = await api('/api/state');
  const ws = new WebSocket(`ws://localhost:${config.port}/ws`);
  ws.on('message', (raw) => { const event = JSON.parse(String(raw)); if (event.type === 'STATE') state = event.state; });
  const waitFor = async (pred: (s: any) => boolean, ms = 300_000) => { const end = Date.now() + ms; while (!pred(state)) { if (Date.now() > end) throw new Error(`timed out in phase ${state.phase}`); await sleep(200); } return state; };

  if (plan.settings) await api('/api/settings', plan.settings);
  if (!['IDLE', 'RELEASE'].includes(state.phase)) await api('/api/stop', {});
  for (const message of plan.opener ?? []) { await say(who(message.from), broadcaster, message.text); await sleep(2500); }
  console.log(`starting "${plan.style} / ${plan.mood}", ${plan.rounds.length} rounds`);
  await api('/api/start', { style: plan.style, mood: plan.mood });

  for (const [index, round] of plan.rounds.entries()) {
    await waitFor((s) => s.phase === 'WRITE' && s.round === index + 1);
    console.log(`round ${index + 1}: write`); await sleep(1500);
    for (const [login, text] of Object.entries(round.lines)) { await say(who(login), broadcaster, `!line ${text}`); await sleep(1800); }
    const vote = await waitFor((s) => s.phase === 'VOTE');
    const target = vote.shortlist.findIndex((line: any) => line.login.toLowerCase() === round.vote.toLowerCase());
    console.log(`round ${index + 1}: vote for @${round.vote}'s line (!${target + 1})`); await sleep(1500);
    for (const login of Object.keys(round.lines)) { await say(who(login), broadcaster, `!${Math.max(0, target) + 1}`); await sleep(1500); }
    await waitFor((s) => ['PLAY', 'RELEASE'].includes(s.phase) || (s.phase === 'WRITE' && s.round === index + 2));
  }
  await waitFor((s) => s.phase === 'RELEASE' && s.clip, 600_000);
  console.log(`released "${state.title}"`);
  ws.close(); process.exit(0);
}
main().catch((error) => { console.error('[rehearse]', error instanceof Error ? error.message : error); process.exit(1); });
