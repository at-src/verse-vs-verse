# Verse vs Verse

**Twitch chat writes a song, live.** Viewers type lyric lines, an AI judge shortlists them, chat votes, and the winning line is sung by an AI band within about 12 seconds. Each round adds a line and the whole song so far plays on stream, with every line drawn as its own animated clay scene and karaoke lyrics. When the song is done, the app can render a music video with per-line writer credits.

Built for the Codex x TwitchCon Hackathon with OpenAI Codex.

- Demo video: _(YouTube link)_
- Runs on real Twitch: EventSub chat in, Helix chat out, an OBS browser-source overlay, and an optional headless "go live" broadcaster.

## How a song works

| Phase | What viewers see | Chat |
|---|---|---|
| WRITE (default 45 s) | "Drop your line." Each new line appears with its author | `!line <your lyric>` (one per viewer per round) |
| VOTE (30 s) | The AI judge's shortlist with live vote counts; the bot lists the options in chat | `!1` `!2` `!3` `!4` |
| PRODUCE (~12 s) | The winning line and its author while the AI band records it | |
| PLAY (~30 s) | The song so far, sung word for word, with a clay scene per line | |
| RELEASE | The finished song with its title and credits; link to the song page | `!song` |

Also: `!help`, `!queue`, and `!skip` (broadcaster or mod). Lines are checked (length, links, spam, OpenAI moderation) before they reach the stream.

## Design

- **One model API for audio (Pascal).** Music, speech-to-text and stems go through one OpenAI-style API, so the music model can be swapped without code changes (`PASCAL_MUSIC_MODEL`). The default clip model returns per-line timings, which drive the karaoke and the scene changes.
- **Chat's exact words.** Lyrics are sent as plain lines with a strict prompt. In tests, section tags made the model invent 40–80% of a song; the strict prompt invented 0 lines in 10 renders. Each clip gets a fidelity score.
- **Clay scenes as code.** An LLM plans each scene as JSON (keyword, mood, mascot pose, props picked by name from a hand-built SVG library). `public/scene-renderer.js` draws every frame: mascot poses, a dance on the beat, mouth movement only on sung words, expression from the lyric, props with their own motion, camera moves and karaoke lyrics. The same renderer drives the live overlay and the video export. The style lives in `skills/clay-scenes/` (SKILL.md, palette, 41 props).
- **Lyric sync.** For longer renders, `src/lyric-sync.ts` aligns chat's lines to a word-level transcript (every repeat, real word times) and the release is trimmed after two full passes.
- **Never fake a song.** If a render fails, the app retries, tells chat, and keeps the winning line; a placeholder tone is never saved as a song.

## Run it

Requirements: Node.js 22, ffmpeg, Chrome (for video export and the headless broadcaster).

```powershell
npm install
Copy-Item .env.example .env   # add keys, see below
npm run dev
```

Open http://localhost:3000/dashboard. Without keys every adapter runs a local mock, so the full flow works offline (`Simulate chat` on the dashboard).

Keys in `.env`:
- `LLM_API_KEY` (any OpenAI-compatible endpoint) for the judge, titles and scenes; `OPENAI_API_KEY` for moderation.
- `PASCAL_API_KEY` for music and speech-to-text.
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_CHANNEL_LOGIN`. Create a Twitch app with redirect URL `http://localhost:3000/auth/callback`, then open `/auth/login` as the broadcaster.

Options: `RELEASE_MODE=full` renders a longer final song with the pro model (default `clip` uses the last round's clip, so there is no extra wait). `MUSIC_VIDEO=on` renders an MP4 music video after each release.

## On stream

- **OBS:** add a Browser Source `http://localhost:3000/overlay` at 1920x1080 (transparent).
- **Without OBS:** `npm run broadcast` renders the overlay headlessly and streams it to the connected channel (stream key read through the Twitch API), and saves a local copy. `npm run broadcast -- --local` only records.
- **Rehearsal / load test:** add test accounts at `/auth/login?actor=1` (they can only send chat and never replace the broadcaster). `npm run rehearse -- demo-scripts/demo-song.json` plays a planned song through real Twitch chat from those accounts. The demo video uses this with our two test accounts.

## Tests

```powershell
npm test          # 42 tests: round engine, lyric sync, timing, moderation fallback, renderer, export
npm run build
```

## How Codex built it

Codex wrote the app in staged prompts (see the git history): scaffold with Twitch OAuth, EventSub and the round engine; real adapters; the clay scene engine and MP4 export; timing and export hardening; line-keyed scenes and animation; lyrics layout and cards; reliability (no fake songs, retries, loop mode, chat commands); and the prop library with the performing mascot. Between stages we tested with real APIs, reviewed exported frames, and committed small fixes separately.
