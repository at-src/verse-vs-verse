import { describe, expect, it } from 'vitest';
import { getSceneForLine, sceneKeyForLine, type SceneIndex } from './scene-index.js';

describe('scene lookup by line',()=>{
  it('keeps each of three scenes attached to its lyric regardless of map insertion order',()=>{
    const lines=[
      {text:'first lyric',login:'a',userId:'1'},
      {text:'second lyric',login:'b',userId:'2'},
      {text:'third lyric',login:'c',userId:'3'},
    ];
    const scenes:SceneIndex={};
    for(const [index,line] of [...lines].reverse().entries())scenes[sceneKeyForLine(line)]={keyword:`scene-${3-index}`,mood:'day',ground:true,mascot:{pose:'stand',x:400,y:350,scale:1,facing:'right'},props:[]};
    expect(lines.map((line)=>getSceneForLine(scenes,line)?.keyword)).toEqual(['scene-1','scene-2','scene-3']);
  });
  it('distinguishes repeated text from the same author when line ids exist',()=>{
    const first={id:'round-1',text:'same lyric',login:'a',userId:'1'};const second={id:'round-2',text:'same lyric',login:'a',userId:'1'};
    const scenes:SceneIndex={[sceneKeyForLine(first)]:{keyword:'first',mood:'day',ground:true,mascot:{pose:'stand',x:400,y:350,scale:1,facing:'right'},props:[]},[sceneKeyForLine(second)]:{keyword:'second',mood:'day',ground:true,mascot:{pose:'stand',x:400,y:350,scale:1,facing:'right'},props:[]}};
    expect(getSceneForLine(scenes,first)?.keyword).toBe('first');expect(getSceneForLine(scenes,second)?.keyword).toBe('second');
  });
});
