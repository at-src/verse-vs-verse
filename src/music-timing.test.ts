import { describe, expect, it } from 'vitest';
import { alignLyricLines, chatLineShare, fillSegmentStarts, formatLyrics, releaseCutPoint } from './adapters/real.js';
const lines = ['line one','line two','line three','line four','line five'].map((text,index)=>({text,userId:String(index),login:'viewer'}));
describe('music lyrics timing',()=>{
  it('formats supplied lyrics as plain lines in order, with no section tags',()=>expect(formatLyrics(lines)).toBe('line one\nline two\nline three\nline four\nline five'));
  it('fills missing pro-model start times between known ones',()=>{
    const result=fillSegmentStarts([{text:'a',start:0},{text:'b'},{text:'c'},{text:'d',start:9},{text:'e'}],12);
    expect(result.map(({start})=>start)).toEqual([0,3,6,9,10.5]);
    expect(result.map(({end})=>end)).toEqual([3,6,9,10.5,12]);
  });
  it('cuts the release after the second full pass of the lyrics',()=>{
    const long=[[0,10],[1,20],[0,30],[1,40],[0,50]].map(([lineIndex,end])=>({lineIndex:lineIndex!,end:end!}));
    expect(releaseCutPoint(long,2,90)).toBe(43); // two passes end at 40 s
    const short=[[0,4],[1,8],[0,14],[1,18],[0,24],[1,28],[0,34]].map(([lineIndex,end])=>({lineIndex:lineIndex!,end:end!}));
    expect(releaseCutPoint(short,2,60)).toBe(27); // two passes end at 18 s: keep going to the first pass end past 22 s
    expect(releaseCutPoint(long.slice(0,1),2,90)).toBe(25); // never got a full pass: keep the minimum
  });
  it('flags lyrics the model invented',()=>{
    expect(chatLineShare(lines.slice(0,1),[{text:'Line one!'},{text:'(oh-oh)'},{text:'line one'}])).toBe(1);
    expect(chatLineShare(lines.slice(0,1),[{text:'line one'},{text:'a pixelated queen in a ball of fur'}])).toBe(0.5);
  });
  it('fuzzy matches punctuation and case with extra Lyria lines, preserving order',()=>{
    const result=alignLyricLines(lines.slice(0,2),[{text:'a musical intro',start:0},{text:'Line, One!',start:2},{text:'extra Lyria lyric',start:4},{text:'LINE TWO.',start:6}],10);
    expect(result).toEqual([{text:'line one',start:2,end:4},{text:'line two',start:6,end:10}]);
  });
  it('interpolates a genuinely missing lyric between matched neighbors',()=>{
    const result=alignLyricLines(lines.slice(0,3),[{text:'LINE ONE!',start:2},{text:'LINE THREE!',start:8}],12);
    expect(result.map(({start})=>start)).toEqual([2,5,8]);
  });
});
