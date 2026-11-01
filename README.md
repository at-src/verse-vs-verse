# Verse vs Verse

Chat writes a song one line at a time. The app runs with local mock adapters when provider keys are missing or a request fails. Real chat audio, judging, moderation, and scripted demo actors can be enabled independently.

## Requirements and run

- Node.js 22
- npm

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard). SQLite is created at `./data/verse-vs-verse.sqlite`; generated Pascal audio is saved under `data/media`.

## Local simulate chat

1. Press **Start song** and choose a style and mood.
2. Set the viewer field to `viewer1`, submit `!line City lights keep me dancing`.
3. Add more lines using different viewer names.
4. Submit `!force-write-end`, vote with `!1` or `!2`, then submit `!force-vote-end`.
5. The overlay plays the mock beat and highlights timed words. `PLAY` advances automatically when the clip finishes; `!force-play-end` is available for fast demos.
6. After `ROUNDS_PER_SONG`, the release moment holds for `RELEASE_SECONDS` then returns to `IDLE`.

## Real services

Set keys in `.env`; each adapter logs a warning and falls back to its mock if a key is absent or a provider call fails.

- **LLM judge and title:** set `LLM_API_KEY`; optionally change `LLM_BASE_URL` and `LLM_MODEL`. The app sends JSON-mode `/chat/completions` requests and validates selected lines against the candidate set.
- **Moderation:** `MODERATION_PROVIDER=openai` uses OpenAI `omni-moderation-latest` when `OPENAI_API_KEY` is set. `MODERATION_PROVIDER=none` keeps the local length, link, repeat, and blocklist checks.
- **Music and voice:** set `PASCAL_API_KEY`. Configure `PASCAL_MUSIC_MODEL`, `PASCAL_RELEASE_MODEL`, `PASCAL_TTS_MODEL`, and `PASCAL_ASR_MODEL`. Pascal audio is downloaded to `data/media` because provider URLs expire. Whisper timings are aligned to known lyrics; timing falls back to even spacing if alignment fails. TTS model parameters are read from `/models`.

Pascal provider response formats can evolve. If an unsupported response shape occurs, the request logs a warning and returns mock audio/voice so the round remains playable.

## Twitch chat

Create a Twitch app and set redirect URL to `http://localhost:3000/auth/callback`. Add `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_CHANNEL_LOGIN` to `.env`, then restart. Connect from the dashboard or visit `/auth/login`. On successful OAuth, the app stores tokens in SQLite, refreshes them automatically, starts EventSub, and sends one announcement per phase.

## Scripted demo actors (real Twitch chat)

Set `DEMO_ACTOR_LOGINS` to the Twitch login(s) of demo actor accounts, and make sure those accounts can send messages in the target channel. Then run:

```powershell
npm run demo:chat
```

The first run prints a Twitch device URL and user code. Sign in with the actor account (scope `user:write:chat`); its token is stored in SQLite. The tool reads `DEMO_SCRIPT_PATH` (default `demo-scripts/demo.json`) and watches the local `/ws` for `WRITE`/`VOTE` phase and round changes. Entries are `{ "phase": "WRITE", "round": 1, "at": 3.5, "text": "!line [lofi_lena] ..." }`, where `at` is seconds after the phase starts. It spaces messages to respect chat rate limits and skips entries beyond configured phase lengths.

Only senders listed in `DEMO_ACTOR_LOGINS` get persona attribution. Their `!line [persona] ...` and `!2 [persona]` tags credit and dedupe by persona; other chatters' tags are ignored as attribution metadata.

## OBS overlay

Add a Browser Source URL `http://localhost:3000/overlay`, width `1920`, height `1080`. The page background is transparent.

## Config and tests

See `.env.example` for provider, Twitch, timing, and spending variables. Songs and tokens are persisted in SQLite; the hourly cap is enforced per running process/channel.

```powershell
npm test
npm run build
```
