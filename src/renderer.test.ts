import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fallbackScene } from './scenes.js';

describe('clay renderer skill examples',()=>{
  it('produces an 800x450 SVG scene for each worked lyric example',async()=>{
    const require=createRequire(import.meta.url);const {renderSceneSvg}=require('../public/scene-renderer.js') as {renderSceneSvg:(scene:unknown,options?:unknown)=>string};
    const source=await readFile('skills/clay-scenes/SKILL.md','utf8');
    const examples=['in a field of dandelions',"wishing on every one that you'd be mine",'and I see forever in your eyes','kabhi uljhe jawaab sa'];
    for(const line of examples){expect(source.toLowerCase()).toContain(line.toLowerCase());const scene=fallbackScene(line,'day');const svg=renderSceneSvg(scene,{line});expect(svg).toContain('viewBox="0 0 800 450"');expect(svg).toContain('id="clay"');expect(svg).toContain('mascot-body');}
  });
});
