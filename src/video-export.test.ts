import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { exportMusicVideo, queueMusicVideoExport } from './video-export.js';

describe('music video export cleanup',()=>{
  it('cleans work folders and kills Chrome when the export times out',async()=>{
    const proc={stdin:{write:()=>true,end:()=>{}},stderr:{setEncoding:()=>{},on:()=>{}},exitCode:null,kill:vi.fn(),once:vi.fn()};
    const spawn=vi.fn(()=>proc as any);const id=`timeout-${Date.now()}`;
    await expect(exportMusicVideo(id,'title','audio.wav',2,[],'fake-chrome','fake-ffmpeg',50,spawn)).rejects.toThrow(/timed out|exited/);
    expect(spawn).toHaveBeenCalled();expect(proc.kill).toHaveBeenCalled();
    const names=await readdir(resolve('data/video-work')).catch(()=>[]);expect(names).not.toContain(id);
  });
});

it('persists a failed status and timeout reason through the export queue',async()=>{
  let status='pending';let reason='';
  const timeout=new Error('Video export timed out after 10 minutes');
  await expect(queueMusicVideoExport('status-song','title','audio.wav',2,[],()=>{status='rendering';},(error)=>{status='failed';reason=String(error);},async()=>{throw timeout;})).rejects.toBe(timeout);
  expect(status).toBe('failed');expect(reason).toContain('timed out after 10 minutes');
});
