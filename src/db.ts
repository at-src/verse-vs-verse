import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';

const path = resolve(config.databasePath);
mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const songColumns = new Set((db.prepare('PRAGMA table_info(songs)').all() as Array<{ name: string }>).map((column) => column.name));
// upgrade an older songs table in place; a fresh database gets the full table below instead
if (songColumns.size && !songColumns.has('video_url')) db.exec('ALTER TABLE songs ADD COLUMN video_url TEXT');
if (songColumns.size && !songColumns.has('video_status')) db.exec("ALTER TABLE songs ADD COLUMN video_status TEXT NOT NULL DEFAULT 'pending'");
db.exec(`
  CREATE TABLE IF NOT EXISTS twitch_tokens (
    user_id TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    scopes TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    style TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    audio_url TEXT NOT NULL,
    video_url TEXT,
    video_status TEXT NOT NULL DEFAULT 'pending',
    duration_sec REAL NOT NULL,
    lines_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS songs_channel_created ON songs(channel_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    line TEXT NOT NULL,
    scene_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);
const errorColumn = new Set((db.prepare('PRAGMA table_info(songs)').all() as Array<{ name: string }>).map((column) => column.name));
if (!errorColumn.has('video_error')) db.exec('ALTER TABLE songs ADD COLUMN video_error TEXT');
