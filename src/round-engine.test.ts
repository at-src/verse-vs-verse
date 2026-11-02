import { describe, expect, it, vi } from 'vitest';
import { RoundEngine } from './round-engine.js';
import { MockLineJudge, MockModeration, MockMusicProvider, MockSceneArtist, MockVoice } from './adapters/mock.js';
import type { MusicClip } from './adapters/types.js';

function makeEngine(now = vi.fn(() => 1000)) {
  const engine = new RoundEngine({
    writeSeconds: 45, voteSeconds: 30, roundsPerSong: 2, maxSongsPerHour: 3,
    channelId: 'test', channelLogin: 'tester', judge: new MockLineJudge(), moderation: new MockModeration(),
    music: new MockMusicProvider(), artist: new MockSceneArtist(), voice: new MockVoice(), now,
  });
  return engine;
}

describe('RoundEngine', () => {
  const realMusic={render:async(_style:string,lines:{text:string}[],_mood?:string,_release?:boolean):Promise<MusicClip>=>({audioUrl:'/media/real.mp3',durationSec:2,words:[],lineTimings:lines.map(line=>({text:line.text,start:0,end:1})),fidelityScore:1,isMock:false})};
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
        music: realMusic, artist: new MockSceneArtist(), voice: new MockVoice(),
      });
      engine.updateSettings({loopMode:false});
      await engine.start();
      await engine.submitLine({ text: 'Paper planes over the city', login: 'a', userId: '1' });
      await vi.advanceTimersByTimeAsync(2_000); // WRITE ends
      await vi.advanceTimersByTimeAsync(2_000); // VOTE ends -> PRODUCE -> PLAY
      expect(engine.snapshot().phase).toBe('PLAY');
      await vi.advanceTimersByTimeAsync(3_100); // final lyric line plus two second breath -> RELEASE
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

  it('allows PLAY skip only through the explicit engine method', async () => {
    const engine = makeEngine(); await engine.start();
    await engine.submitLine({ text: 'a gentle cat', login: 'one', userId: '1' });
    await engine.finishWrite(); await engine.finishVote();
    expect(engine.snapshot().phase).toBe('PLAY');
    expect(engine.skipPlay()).toBe(true);
    await Promise.resolve();
    expect(['WRITE','RELEASE']).toContain(engine.snapshot().phase);
    expect(engine.skipPlay()).toBe(false);
  });

  it('ends a long round clip shortly after the last lyric line end', async () => {
    vi.useFakeTimers();
    try {
      const music = { render: vi.fn(async () => ({ audioUrl:'/media/test.mp3', durationSec:30, words:[{word:'one',start:0,end:1},{word:'two',start:3,end:4}], lineTimings:[{text:'one two',start:0,end:4}] })) };
      const engine = new RoundEngine({ writeSeconds:50,voteSeconds:50,roundsPerSong:4,maxSongsPerHour:4,channelId:'x',channelLogin:'x',judge:new MockLineJudge(),moderation:new MockModeration(),music,artist:new MockSceneArtist(),voice:new MockVoice() });
      await engine.start();await engine.submitLine({text:'one two',login:'x',userId:'x'});await engine.finishWrite();await engine.finishVote();
      await vi.advanceTimersByTimeAsync(5_900);expect(engine.snapshot().phase).toBe('PLAY');
      await vi.advanceTimersByTimeAsync(200);expect(engine.snapshot().phase).toBe('WRITE');
      engine.stop();
    } finally { vi.useRealTimers(); }
  });
  it('keeps a winning line when all round music attempts fail and advances without a fake clip',async()=>{
    const failed={render:vi.fn(async()=>{throw new Error('Pascal unavailable');})};const engine=new RoundEngine({writeSeconds:30,voteSeconds:30,roundsPerSong:2,maxSongsPerHour:3,channelId:'x',channelLogin:'x',judge:new MockLineJudge(),moderation:new MockModeration(),music:failed,artist:new MockSceneArtist(),voice:new MockVoice()});
    await engine.start();await engine.submitLine({text:'our exact winning line',login:'writer',userId:'writer'});await engine.finishWrite();await engine.finishVote();
    expect(engine.snapshot().song.map(line=>line.text)).toEqual(['our exact winning line']);expect(engine.snapshot().clip).toBeNull();expect(engine.snapshot().phase).toBe('PLAY');expect(failed.render).toHaveBeenCalledTimes(1);engine.stop();
  });
  it('regenerates a low-fidelity round clip once with strict lyrics',async()=>{
    const render=vi.fn(async(_style:string,_lines:unknown,_mood?:string,_release?:boolean,strict?:boolean):Promise<MusicClip>=>({audioUrl:'/media/real.mp3',durationSec:2,words:[],fidelityScore:strict?.8:.4,isMock:false}));
    const engine=new RoundEngine({writeSeconds:30,voteSeconds:30,roundsPerSong:2,maxSongsPerHour:3,channelId:'x',channelLogin:'x',judge:new MockLineJudge(),moderation:new MockModeration(),music:{render},artist:new MockSceneArtist(),voice:new MockVoice()});
    await engine.start();await engine.submitLine({text:'the exact line',login:'writer',userId:'writer'});await engine.finishWrite();await engine.finishVote();expect(render).toHaveBeenCalledTimes(2);expect(render.mock.calls[1]?.[4]).toBe(true);engine.stop();
  });
  it('keeps a failed release retryable and saves it only after a real retry succeeds',async()=>{
    let calls=0;const music={render:vi.fn(async()=>{calls++;if(calls===2)throw new Error('release failed');return{audioUrl:'/media/real.mp3',durationSec:2,words:[],lineTimings:[],isMock:false,fidelityScore:.9};})};const saveSong=vi.fn();
    const engine=new RoundEngine({writeSeconds:30,voteSeconds:30,roundsPerSong:1,maxSongsPerHour:3,channelId:'x',channelLogin:'x',judge:new MockLineJudge(),moderation:new MockModeration(),music,artist:new MockSceneArtist(),voice:new MockVoice(),saveSong});
    await engine.start();await engine.submitLine({text:'the release lyric',login:'writer',userId:'writer'});await engine.finishWrite();await engine.finishVote();await engine.finishPlay();
    expect(engine.snapshot().releaseFailed).toBe(true);expect(saveSong).not.toHaveBeenCalled();expect(await engine.retryRelease()).toBe(true);expect(engine.snapshot().releaseFailed).toBe(false);expect(saveSong).toHaveBeenCalledTimes(1);engine.stop();
  });
  it('loops after the release hold and waits once when the hourly cap is reached',async()=>{
    vi.useFakeTimers();try{const limit=vi.fn();const engine=new RoundEngine({writeSeconds:30,voteSeconds:30,roundsPerSong:1,maxSongsPerHour:1,releaseSeconds:1,channelId:'x',channelLogin:'x',judge:new MockLineJudge(),moderation:new MockModeration(),music:realMusic,artist:new MockSceneArtist(),voice:new MockVoice(),onLoopLimit:limit});
      await engine.start();await engine.submitLine({text:'first song line',login:'a',userId:'a'});await engine.finishWrite();await engine.finishVote();await engine.finishPlay();expect(engine.snapshot().phase).toBe('RELEASE');
      await vi.advanceTimersByTimeAsync(1000);expect(engine.snapshot().phase).toBe('IDLE');expect(engine.snapshot().loopWaiting).toBe(true);expect(limit).toHaveBeenCalledTimes(1);engine.stop();
    }finally{vi.useRealTimers();}
  });
});
