// Align chat's lyric lines to the words a speech-to-text model heard in the song.
// Finds every place each line is sung (repeats included) with real per-word times, and ignores
// anything the model heard that isn't chat's lyrics (ad-libs, "oh-oh", hallucinated words).
import type { TimedWord } from './adapters/types.js';

export type SyncedSegment = { text: string; lineIndex: number; start: number; end: number; words: TimedWord[] };
export type SyncResult = { segments: SyncedSegment[]; linesFound: number; matchedWords: number; expectedWords: number };

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '').replace(/'/g, '');

function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let diag = rows[0]!; rows[0] = j;
    for (let i = 1; i <= a.length; i++) { const old = rows[i]!; rows[i] = Math.min(rows[i]! + 1, rows[i - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1)); diag = old; }
  }
  return 1 - rows[a.length]! / Math.max(a.length, b.length) >= 0.6; // "chad"/"chat", "mons"/"mods", "chayette"/"chai"
}

// best fuzzy LCS of a lyric line against heard[from .. from+window), first match must be near `from`
function matchAt(line: string[], heard: string[], from: number): { score: number; pairs: Array<[number, number]> } {
  const window = Math.min(heard.length - from, line.length + 3);
  if (window <= 0) return { score: 0, pairs: [] };
  const dp = Array.from({ length: line.length + 1 }, () => new Array<number>(window + 1).fill(0));
  for (let i = 1; i <= line.length; i++) for (let j = 1; j <= window; j++)
    dp[i]![j] = close(line[i - 1]!, heard[from + j - 1]!) ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  const pairs: Array<[number, number]> = [];
  for (let i = line.length, j = window; i > 0 && j > 0;) {
    if (close(line[i - 1]!, heard[from + j - 1]!) && dp[i]![j] === dp[i - 1]![j - 1]! + 1) { pairs.unshift([i - 1, from + j - 1]); i--; j--; }
    else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) i--; else j--;
  }
  if (!pairs.length || pairs[0]![1] > from + 1) return { score: 0, pairs: [] };
  return { score: pairs.length / line.length, pairs };
}

export function syncLyrics(lines: string[], heardWords: TimedWord[], duration: number, minScore = 0.6): SyncResult {
  const lineWords = lines.map((line) => line.split(/\s+/).map(norm).filter(Boolean));
  const original = lines.map((line) => line.split(/\s+/).filter((word) => norm(word)));
  const heard = heardWords.filter((word) => norm(word.word) && Number.isFinite(word.start));
  const tokens = heard.map((word) => norm(word.word));
  const segments: SyncedSegment[] = [];
  let matchedWords = 0, expectedWords = 0;
  for (let at = 0; at < tokens.length;) {
    let best: { index: number; score: number; pairs: Array<[number, number]> } | null = null;
    lineWords.forEach((words, index) => {
      if (!words.length) return;
      const result = matchAt(words, tokens, at);
      if (result.score >= minScore && (!best || result.score > best.score || (result.score === best.score && words.length > lineWords[best.index]!.length))) best = { index, ...result };
    });
    if (!best) { at++; continue; }
    const { index, pairs } = best as { index: number; score: number; pairs: Array<[number, number]> };
    const words = original[index]!;
    const times: Array<{ start: number; end: number } | undefined> = words.map(() => undefined);
    for (const [wordIndex, heardIndex] of pairs) {
      const item = heard[heardIndex]!;
      times[wordIndex] = { start: item.start, end: Math.max(item.end ?? item.start, item.start) };
    }
    // fill words the model missed, between their matched neighbours
    for (let i = 0; i < times.length; i++) {
      if (times[i]) continue;
      let prev = i - 1; while (prev >= 0 && !times[prev]) prev--;
      let next = i + 1; while (next < times.length && !times[next]) next++;
      const left = prev >= 0 ? times[prev]!.end : (times[next]?.start ?? 0) - 0.3 * (next - i);
      const right = next < times.length ? times[next]!.start : left + 0.3 * (i - prev);
      const step = (right - left) / (next - prev);
      times[i] = { start: left + step * (i - prev - 1), end: left + step * (i - prev) };
    }
    // on the full mix the last word of a phrase is often stamped seconds late; a word can't lag its neighbour by > 1.2 s
    for (let i = 1; i < times.length; i++) {
      const prev = times[i - 1]!, cur = times[i]!;
      if (cur.start - prev.end > 1.2) { const length = Math.min(0.6, Math.max(0.2, cur.end - cur.start)); cur.start = prev.end + 0.1; cur.end = cur.start + length; }
    }
    const timed = words.map((word, i) => { const t = times[i]!; const start = Math.max(0, Math.min(duration, t.start)); return { word, start, end: Math.min(duration, Math.max(start + 0.15, t.end)) }; });
    segments.push({ text: lines[index]!, lineIndex: index, start: timed[0]!.start, end: timed.at(-1)!.end, words: timed });
    matchedWords += pairs.length; expectedWords += words.length;
    at = pairs.at(-1)![1] + 1;
  }
  // keep segments in order and never overlapping
  segments.sort((a, b) => a.start - b.start);
  for (let i = 0; i < segments.length - 1; i++) if (segments[i]!.end > segments[i + 1]!.start) segments[i]!.end = Math.max(segments[i]!.start + 0.2, segments[i + 1]!.start);
  return { segments, linesFound: new Set(segments.map((segment) => segment.lineIndex)).size, matchedWords, expectedWords };
}
