import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatLyrics, OpenCompatibleJudge, PascalProvider, scoreSungFidelity } from './real.js';
import type { CandidateLine } from './types.js';

const a: CandidateLine = { text: 'Cat stole the controller', login: 'lena', userId: '1' };
const b: CandidateLine = { text: 'The router is a disco ball', login: 'chai', userId: '2' };

afterEach(() => vi.unstubAllGlobals());

describe('real adapters', () => {
  it('falls back for LLM judging and never returns a non-candidate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const judge = new OpenCompatibleJudge('test-key', 'http://fake/v1', 'fake-model');
    const fallback = await judge.choose([a, b], [], 'pop', 'silly');
    expect(fallback).toEqual([a, b]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines: [a.text, 'invented line', b.text] }) } }] }), { status: 200 })));
    const selected = await judge.choose([a, b], [], 'pop', 'silly');
    expect(selected).toEqual([a, b]);
    expect(selected.every((line) => line.text === a.text || line.text === b.text)).toBe(true);
  });

  it('never substitutes mock audio after real Pascal failures and backs off twice', async () => {
    const logged=vi.spyOn(console,'error').mockImplementation(()=>undefined);const delays:number[]=[];
    const fetchMock=vi.fn(()=>Promise.resolve(new Response(JSON.stringify({id:'job-failed',status:'failed',error_code:'bad_request',error_message:'no audio'}),{status:200})));
    vi.stubGlobal('fetch',fetchMock);
    const provider=new PascalProvider('test-key','http://fake',async ms=>{delays.push(ms);});
    await expect(provider.render('pop',[a])).rejects.toThrow('no audio');
    expect(fetchMock).toHaveBeenCalledTimes(3);expect(delays).toEqual([3000,8000]);expect(logged).toHaveBeenCalledTimes(3);
    expect(logged.mock.calls[0]?.[0]).toContain('error_code=bad_request job_id=job-failed');
  });

  it('uses the mock only when the Pascal key is absent',async()=>{
    const clip=await new PascalProvider('','http://fake').render('pop',[a]);
    expect(clip.isMock).toBe(true);expect(clip.audioUrl).toContain('mock-tone');
  });

  it('scores expected words found in transcript order and formats only supplied lyric lines',()=>{
    const transcript='Cat extra stole the controller The router is a disco ball'.split(' ').map((word,index)=>({word,start:index,end:index+0.5}));
    expect(scoreSungFidelity([a,b],transcript)).toBe(1);
    expect(scoreSungFidelity([a],[{word:'Cat',start:0,end:1},{word:'controller',start:1,end:2},{word:'stole',start:2,end:3}])).toBeCloseTo(0.5);
    const lyrics=formatLyrics([a,b],true);expect(lyrics).toContain(a.text);expect(lyrics).toContain(b.text);expect(lyrics).not.toContain('[Chorus]');
  });
});
