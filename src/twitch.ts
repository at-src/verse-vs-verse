import WebSocket from 'ws';
import { db } from './db.js';
import { config } from './config.js';
import type { RoundEngine } from './round-engine.js';

type TokenRow = { user_id: string; login: string; access_token: string; refresh_token: string; expires_at: number };
type EventEnvelope = { metadata: { message_type: string; subscription_type?: string }; payload: Record<string, any> };

export class TwitchService {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectUrl: string | null = null;
  private reconnecting = false;
  private stopped = false;

  constructor(private readonly engine: RoundEngine) {}

  private token(): TokenRow | undefined {
    return db.prepare('SELECT * FROM twitch_tokens ORDER BY updated_at DESC LIMIT 1').get() as TokenRow | undefined;
  }

  private async accessToken(): Promise<TokenRow> {
    const row = this.token();
    if (!row) throw new Error('Connect a Twitch account at /auth/login first.');
    if (row.expires_at > Date.now() + 60_000) return row;
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token, client_id: config.twitchClientId, client_secret: config.twitchClientSecret }),
    });
    if (!response.ok) throw new Error(`Twitch token refresh failed (${response.status}).`);
    const value = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
    db.prepare('UPDATE twitch_tokens SET access_token=?, refresh_token=?, expires_at=?, updated_at=? WHERE user_id=?')
      .run(value.access_token, value.refresh_token, Date.now() + value.expires_in * 1000, Date.now(), row.user_id);
    return { ...row, access_token: value.access_token, refresh_token: value.refresh_token, expires_at: Date.now() + value.expires_in * 1000 };
  }

  private async helix(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken();
    return fetch(`https://api.twitch.tv/helix/${path}`, {
      ...init,
      headers: { 'Client-Id': config.twitchClientId, Authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json', ...init.headers },
    });
  }

  async sendChat(text: string): Promise<void> {
    const token = this.token();
    if (!token) return;
    const response = await this.helix('chat/messages', { method: 'POST', body: JSON.stringify({ broadcaster_id: token.user_id, sender_id: token.user_id, message: text.slice(0, 500) }) });
    if (!response.ok) console.error(`Twitch chat send failed (${response.status})`);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void { this.stopped = true; this.socket?.close(); this.socket = null; }

  private async connect(url = 'wss://eventsub.wss.twitch.tv/ws'): Promise<void> {
    if (this.stopped) return;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.on('message', (raw) => void this.onMessage(socket, JSON.parse(raw.toString()) as EventEnvelope));
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      if (!this.stopped && !this.reconnecting) setTimeout(() => void this.connect(), 2500);
    });
    socket.on('error', (error) => console.error('EventSub WebSocket error:', error.message));
  }

  private async onMessage(socket: WebSocket, event: EventEnvelope): Promise<void> {
    const type = event.metadata.message_type;
    if (type === 'session_welcome') {
      this.sessionId = event.payload.session.id;
      if (this.reconnectUrl) { this.reconnectUrl = null; return; }
      const token = await this.accessToken();
      const response = await this.helix('eventsub/subscriptions', { method: 'POST', body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: token.user_id, user_id: token.user_id }, transport: { method: 'websocket', session_id: this.sessionId } }) });
      if (!response.ok) console.error('EventSub subscription failed:', response.status, await response.text());
    } else if (type === 'session_reconnect') {
      this.reconnecting = true;
      this.reconnectUrl = event.payload.session.reconnect_url;
      await this.connect(this.reconnectUrl ?? undefined);
      socket.close();
      this.reconnecting = false;
    } else if (type === 'notification' && event.metadata.subscription_type === 'channel.chat.message') {
      const message = event.payload.event;
      const login = String(message.chatter_user_login ?? 'viewer');
      const userId = String(message.chatter_user_id ?? login);
      const text = String(message.message?.text ?? '');
      let accepted = false;
      if (text.toLowerCase().startsWith('!line ')) accepted = await this.engine.submitLine({ text: text.slice(6), login, userId });
      else if (/^![1-4]$/.test(text)) accepted = this.engine.vote(userId, Number(text.slice(1)) - 1);
      if (accepted) await this.sendChat(text.startsWith('!line') ? `line saved @${login}` : `vote counted @${login}`);
    }
  }
}
