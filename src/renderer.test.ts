import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fallbackScene } from './scenes.js';
import { exportPageHtml, selectVideoFrame } from './video-export.js';

describe('clay renderer skill examples',()=>{
  it('produces an 800x450 SVG scene for each worked lyric example',async()=>{
    const require=createRequire(import.meta.url);const {renderSceneSvg}=require('../public/scene-renderer.js') as {renderSceneSvg:(scene:unknown,options?:unknown)=>string};
    const source=await readFile('skills/clay-scenes/SKILL.md','utf8');
    const examples=['in a field of dandelions',"wishing on every one that you'd be mine",'and I see forever in your eyes','kabhi uljhe jawaab sa'];
    for(const line of examples){expect(source.toLowerCase()).toContain(line.toLowerCase());const scene=fallbackScene(line,'day');const svg=renderSceneSvg(scene,{line});expect(svg).toContain('viewBox="0 0 800 450"');expect(svg).toContain('id="clay"');expect(svg).toContain('mascot-body');}
  });
  it('renders an animated prop differently at t=0 and t=1',()=>{
    const require=createRequire(import.meta.url);const {renderSceneSvg}=require('../public/scene-renderer.js') as {renderSceneSvg:(scene:unknown,options?:unknown)=>string};
    const scene={...fallbackScene('a paper plane flies','day'),props:[{id:'plane',enter:'drop',svg:'<g><circle cx="400" cy="250" r="30" fill="#ffd23f"/></g>'}]};
    expect(renderSceneSvg(scene,{time:0})).not.toBe(renderSceneSvg(scene,{time:1}));
  });
  it('uses the bundled display font on the export page and selects interludes for long gaps',()=>{
    const html=exportPageHtml();expect(html).toContain('/fonts/Chewy-Regular.ttf');expect(html).toContain('document.fonts.ready');
    const lines=['one','two'].map((text,index)=>({lineKey:String(index),line:{text,userId:String(index),login:'viewer'},scene:fallbackScene(text,'day'),start:index===0?0:20,end:index===0?4:24,words:[]}));
    expect(selectVideoFrame(12,lines)).toMatchObject({interlude:true,sceneStart:0,cameraStart:4,entry:lines[0]});
    const require=createRequire(import.meta.url);const {renderSceneSvg}=require('../public/scene-renderer.js') as {renderSceneSvg:(scene:unknown,options?:unknown)=>string};
    expect(renderSceneSvg(lines[0]!.scene,{quality:'export'})).toContain('numOctaves="1"');
  });
});
