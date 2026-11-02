// Shared by the rehearsal and broadcast scripts: return a valid access token, refreshing it with the stored refresh token.
import { db } from '../src/db.js';
import { config } from '../src/config.js';

export type TokenRow = { user_id: string; login: string; access_token: string; refresh_token: string; expires_at: number };

export async function freshToken(row: TokenRow): Promise<TokenRow> {
  if (row.expires_at > Date.now() + 5 * 60_000) return row;
  const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token, client_id: config.twitchClientId, client_secret: config.twitchClientSecret }) });
  if (!response.ok) throw new Error(`Twitch token refresh for @${row.login} failed (${response.status}); log in again at /auth/login`);
  const value = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
  const next = { ...row, access_token: value.access_token, refresh_token: value.refresh_token, expires_at: Date.now() + value.expires_in * 1000 };
  db.prepare('UPDATE twitch_tokens SET access_token=?, refresh_token=?, expires_at=?, updated_at=? WHERE user_id=?').run(next.access_token, next.refresh_token, next.expires_at, Date.now(), row.user_id);
  return next;
}

export async function allTokens(): Promise<TokenRow[]> {
  const rows = db.prepare('SELECT user_id, login, access_token, refresh_token, expires_at FROM twitch_tokens').all() as TokenRow[];
  return Promise.all(rows.map(freshToken));
}
