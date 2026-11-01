import 'dotenv/config';

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
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
};
