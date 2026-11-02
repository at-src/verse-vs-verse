import { describe, expect, it } from 'vitest';
import { alignLyricLines, formatLyrics } from './adapters/real.js';
const lines = ['line one','line two','line three','line four','line five'].map((text,index)=>({text,userId:String(index),login:'viewer'}));
describe('music lyrics timing',()=>{
  it('formats supplied lyrics in order without a chorus tag that could cause invented repeats',()=>expect(formatLyrics(lines)).toBe('[Verse 1]\nline one\n[Verse 2]\nline two\n[Bridge]\nline three\n[Verse 3]\nline four\n[Verse 5]\nline five'));
  it('fuzzy matches punctuation and case with extra Lyria lines, preserving order',()=>{
    const result=alignLyricLines(lines.slice(0,2),[{text:'a musical intro',start:0},{text:'Line, One!',start:2},{text:'extra Lyria lyric',start:4},{text:'LINE TWO.',start:6}],10);
    expect(result).toEqual([{text:'line one',start:2,end:4},{text:'line two',start:6,end:10}]);
  });
  it('interpolates a genuinely missing lyric between matched neighbors',()=>{
    const result=alignLyricLines(lines.slice(0,3),[{text:'LINE ONE!',start:2},{text:'LINE THREE!',start:8}],12);
    expect(result.map(({start})=>start)).toEqual([2,5,8]);
  });
});
