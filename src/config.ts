import 'dotenv/config';

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const GENRES: Record<string, string> = {
  pop: 'bright, buoyant, polished pop with a catchy hook',
  'lo-fi': 'mellow, hazy, warm vinyl crackle, soft piano',
  rock: 'energetic, punchy drums, crunchy guitars, anthemic',
  synthwave: 'nostalgic, neon, driving synths',
  ballad: 'tender, heartfelt, spacious piano and strings',
  'hip-hop': 'confident, rhythmic, crisp drums and deep bass',
  'desi pop': 'bright, dhol and synth, catchy hook',
};

export const config = {
  genres: GENRES,
  port: positiveInt(process.env.PORT, 3000),
  databasePath: process.env.DATABASE_PATH ?? './data/verse-vs-verse.sqlite',
  writeSeconds: positiveInt(process.env.WRITE_SECONDS, 45),
  voteSeconds: positiveInt(process.env.VOTE_SECONDS, 30),
  roundsPerSong: positiveInt(process.env.ROUNDS_PER_SONG, 4),
  releaseSeconds: positiveInt(process.env.RELEASE_SECONDS, 20),
  maxSongsPerHour: positiveInt(process.env.MAX_SONGS_PER_HOUR, 3),
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? '',
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? '',
  twitchRedirectUri: process.env.TWITCH_REDIRECT_URI ?? 'http://localhost:3000/auth/callback',
  twitchChannelLogin: process.env.TWITCH_CHANNEL_LOGIN ?? '',
  llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
  llmApiKey: process.env.LLM_API_KEY ?? '',
  llmModel: process.env.LLM_MODEL ?? 'gpt-4.1-mini',
  moderationProvider: process.env.MODERATION_PROVIDER ?? 'openai',
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  pascalApiKey: process.env.PASCAL_API_KEY ?? '',
  pascalBaseUrl: process.env.PASCAL_BASE_URL ?? 'https://api.pascalai.co/v1',
  pascalMusicModel: process.env.PASCAL_MUSIC_MODEL ?? 'lyria-3-clip-preview',
  pascalReleaseModel: process.env.PASCAL_RELEASE_MODEL ?? 'lyria-3-pro-preview',
  pascalTtsModel: process.env.PASCAL_TTS_MODEL ?? '',
  pascalAsrModel: process.env.PASCAL_ASR_MODEL ?? 'whisper-large-v3',
  demoActorLogins: (process.env.DEMO_ACTOR_LOGINS ?? '').split(',').map((login) => login.trim().toLowerCase()).filter(Boolean),
  demoScriptPath: process.env.DEMO_SCRIPT_PATH ?? './demo-scripts/demo.json',
};
