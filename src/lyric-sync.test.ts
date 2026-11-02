import { describe, expect, it } from 'vitest';
import { syncLyrics } from './lyric-sync.js';

const heard = (text: string, start: number, step = 0.3) => text.split(' ').map((word, i) => ({ word, start: start + i * step, end: start + i * step + 0.25 }));

describe('lyric sync', () => {
  const lines = ['chai at midnight with the city lights', 'we were dancing in the rain'];
  it('finds every sung repeat with real word times and skips ad-libs', () => {
    const words = [...heard('Chai at midnight with the city lights', 1), ...heard('oh oh yeah', 4), ...heard('We were dancing in the rain', 6), ...heard('chai at midnight with the city lights', 12), ...heard('you', 20)];
    const result = syncLyrics(lines, words, 30);
    expect(result.segments.map((s) => [s.lineIndex, Number(s.start.toFixed(1))])).toEqual([[0, 1], [1, 6], [0, 12]]);
    expect(result.segments[1]!.words.map((w) => w.word)).toEqual(['we', 'were', 'dancing', 'in', 'the', 'rain']);
    expect(result.segments[1]!.words[2]!.start).toBeCloseTo(6.6);
  });
  it('tolerates misheard words and fills a missed word between neighbours', () => {
    const words = heard('Shy at midnight with city lights', 2);
    const [segment] = syncLyrics(lines, words, 30).segments;
    expect(segment!.lineIndex).toBe(0);
    expect(segment!.words).toHaveLength(7);
    expect(segment!.words[5]!.start).toBeGreaterThan(segment!.words[4]!.start);
  });
  it('pulls back a last word the model stamped seconds late', () => {
    const words = [...heard('we were dancing in the', 10), { word: 'rain', start: 14.5, end: 14.8 }];
    const [segment] = syncLyrics(lines, words, 30).segments;
    expect(segment!.words.at(-1)!.start).toBeLessThan(12);
  });
});
