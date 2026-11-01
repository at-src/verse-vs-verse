# Verse vs Verse

Chat writes a song one line at a time. The first pass runs locally with offline adapters, a mock beat, a synced lyric overlay, and a simulation panel. Twitch integration follows the same engine boundary and is stubbed for the next iteration.

## Requirements

- Node.js 22
- npm

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard). The API and WebSocket server run on the same port. SQLite is created at `./data/verse-vs-verse.sqlite`.

## Try simulate chat

1. Press **Start song** and choose a style and mood.
2. Set the viewer field to `viewer1`, submit `!line City lights keep me dancing`.
3. Add another line with a different viewer name.
4. Submit `!force-write-end` to open voting early.
5. Send `!1` or `!2` as a viewer vote. Votes are one per viewer for the round.
6. Submit `!force-vote-end` to render the mock clip. The overlay plays it and highlights words against timing data.
7. Submit `!force-play-end` to move to the next round. `ROUNDS_PER_SONG` controls when the release is saved.

Force commands exist only to make local demos quick; production timing uses the configured timers. The mock clip is a generated WAV beat with evenly spaced lyric timings.

## OBS overlay

Add a **Browser Source** in OBS with URL `http://localhost:3000/overlay`, width `1920`, height `1080`. The page background is transparent. Add the source to the scene before starting a song.

## Twitch app setup (OAuth integration pending)

Create an app in the Twitch Developer Console. Set the OAuth redirect URL to `http://localhost:3000/auth/callback`. Copy its Client ID and Client Secret into `.env`, set `TWITCH_CHANNEL_LOGIN`, then restart the app. The requested scopes are `user:read:chat user:write:chat channel:read:redemptions moderator:read:followers`. OAuth, token refresh, EventSub, and Helix chat send are the next integration slice; this first pass deliberately runs without Twitch credentials.

## Config

`WRITE_SECONDS`, `VOTE_SECONDS`, `ROUNDS_PER_SONG`, `MAX_SONGS_PER_HOUR`, `DATABASE_PATH`, and `PORT` can be set in `.env`. Spending limit is enforced per running process and channel; released songs are persisted in SQLite.

## Adapters

`src/adapters/types.ts` defines `LineJudge`, `Moderation`, `MusicProvider`, `SceneArtist`, and `Voice`. The mock adapters are offline and deterministic. `public/scene-renderer.js` is the clear scene entry point for later clay-style art.

## Tests

```powershell
npm test
npm run build
```
