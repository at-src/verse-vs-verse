import { describe, expect, it } from 'vitest';
import { alignLyricLines, formatLyrics } from './adapters/real.js';
const lines = ['line one','line two','line three','line four','line five'].map((text,index)=>({text,userId:String(index),login:'viewer'}));
describe('music lyrics timing',()=>{
  it('formats lyrics into the required ordered sections and repeats chorus',()=>expect(formatLyrics(lines)).toBe('[Verse 1]\nline one\n[Chorus]\nline two\n[Verse 2]\nline three\n[Bridge]\nline four\n[Chorus]\nline five'));
  it('matches Pascal lyric line timing and infers missing end from the next start',()=>expect(alignLyricLines(lines.slice(0,2),[{text:'LINE TWO',start:5},{text:'line one',start:1}],10)).toEqual([{text:'line one',start:1,end:5},{text:'line two',start:5,end:10}]));
});
