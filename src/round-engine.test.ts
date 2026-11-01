import { describe, expect, it, vi } from 'vitest';
import { RoundEngine } from './round-engine.js';
import { MockLineJudge, MockModeration, MockMusicProvider, MockSceneArtist, MockVoice } from './adapters/mock.js';

function makeEngine(now = vi.fn(() => 1000)) {
  const engine = new RoundEngine({
    writeSeconds: 45, voteSeconds: 30, roundsPerSong: 2, maxSongsPerHour: 3,
    channelId: 'test', channelLogin: 'tester', judge: new MockLineJudge(), moderation: new MockModeration(),
    music: new MockMusicProvider(), artist: new MockSceneArtist(), voice: new MockVoice(), now,
  });
  return engine;
}

describe('RoundEngine', () => {
  it('accepts one clean line per user and rejects links and duplicates', async () => {
    const engine = makeEngine();
    await engine.start();
    expect(await engine.submitLine({ text: 'City lights are dancing', login: 'a', userId: '1' })).toBe(true);
    expect(await engine.submitLine({ text: 'Second line', login: 'a', userId: '1' })).toBe(false);
    expect(await engine.submitLine({ text: 'look at https://example.com', login: 'b', userId: '2' })).toBe(false);
  });

  it('shortlists, tallies one vote per user, produces, and releases after configured rounds', async () => {
    const engine = makeEngine();
    await engine.start();
    await engine.submitLine({ text: 'Moonlight on the avenue', login: 'one', userId: '1' });
    await engine.submitLine({ text: 'We are louder than the rain', login: 'two', userId: '2' });
    await engine.finishWrite();
    expect(engine.snapshot().phase).toBe('VOTE');
    expect(engine.vote('voter', 1)).toBe(true);
    expect(engine.vote('voter', 0)).toBe(false);
    await engine.finishVote();
    expect(engine.snapshot().phase).toBe('PLAY');
    expect(engine.snapshot().song[0]?.login).toBe('two');
    await engine.finishPlay();
    expect(engine.snapshot().phase).toBe('WRITE');
    await engine.submitLine({ text: 'Neon rivers carry us home', login: 'three', userId: '3' });
    await engine.finishWrite(); await engine.finishVote(); await engine.finishPlay();
    expect(engine.snapshot().phase).toBe('RELEASE');
  });

  it('moves on from PLAY by itself and returns to IDLE after the release', async () => {
    vi.useFakeTimers();
    try {
      const engine = new RoundEngine({
        writeSeconds: 2, voteSeconds: 2, roundsPerSong: 1, maxSongsPerHour: 5, releaseSeconds: 3,
        channelId: 'test', channelLogin: 'tester', judge: new MockLineJudge(), moderation: new MockModeration(),
        music: new MockMusicProvider(), artist: new MockSceneArtist(), voice: new MockVoice(),
      });
      await engine.start();
      await engine.submitLine({ text: 'Paper planes over the city', login: 'a', userId: '1' });
      await vi.advanceTimersByTimeAsync(2_000); // WRITE ends
      await vi.advanceTimersByTimeAsync(2_000); // VOTE ends -> PRODUCE -> PLAY
      expect(engine.snapshot().phase).toBe('PLAY');
      await vi.advanceTimersByTimeAsync(5_600); // mock clip is 4s (one short line) + 1.5s -> RELEASE
      expect(engine.snapshot().phase).toBe('RELEASE');
      await vi.advanceTimersByTimeAsync(3_100); // release hold
      expect(engine.snapshot().phase).toBe('IDLE');
      await engine.start(); // a new song can start again
      expect(engine.snapshot().phase).toBe('WRITE');
      engine.stop();
    } finally { vi.useRealTimers(); }
  });

  it('enforces the hourly song limit', async () => {
    const engine = new RoundEngine({
      writeSeconds: 45, voteSeconds: 30, roundsPerSong: 1, maxSongsPerHour: 1,
      channelId: 'test', channelLogin: 'tester', judge: new MockLineJudge(), moderation: new MockModeration(),
      music: new MockMusicProvider(), artist: new MockSceneArtist(), voice: new MockVoice(), now: () => 5000,
    });
    await engine.start();
    engine.stop();
    await expect(engine.start()).rejects.toThrow('Hourly song limit reached');
  });
});
