import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCompatibleJudge, PascalProvider } from './real.js';
import type { CandidateLine } from './types.js';

const a: CandidateLine = { text: 'Cat stole the controller', login: 'lena', userId: '1' };
const b: CandidateLine = { text: 'The router is a disco ball', login: 'chai', userId: '2' };

afterEach(() => vi.unstubAllGlobals());

describe('real adapter fallback', () => {
  it('falls back when the LLM call throws and never returns a non-candidate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const judge = new OpenCompatibleJudge('test-key', 'http://fake/v1', 'fake-model');
    const fallback = await judge.choose([a, b], [], 'pop', 'silly');
    expect(fallback).toEqual([a, b]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines: [a.text, 'invented line', b.text] }) } }] }), { status: 200 })));
    const selected = await judge.choose([a, b], [], 'pop', 'silly');
    expect(selected).toEqual([a, b]);
    expect(selected.every((line) => line.text === a.text || line.text === b.text)).toBe(true);
  });

  it('falls back when Pascal music job is failed', async () => {
    const error = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'job-1', status: 'failed', error_code: 'bad_request', error_message: 'nope' }), { status: 200 })));
    const clip = await new PascalProvider('test-key', 'http://fake').render('pop', [a]);
    expect(clip.audioUrl).toContain('/media/mock-tone.wav');
    expect(error).toHaveBeenCalled();
  });

  it('retries Pascal music once after a transient failure', async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>undefined);let attempts=0;
    vi.stubGlobal('fetch',vi.fn(async()=>{attempts++;return attempts===1?new Response('temporary failure',{status:503}):new Response(JSON.stringify({id:'job-2',status:'failed',error_code:'no_audio',error_message:'no audio'}),{status:200});}));
    const clip=await new PascalProvider('test-key','http://fake').render('pop',[a]);
    expect(attempts).toBe(2);expect(clip.audioUrl).toContain('mock-tone');expect(warn).toHaveBeenCalled();
  });
});
