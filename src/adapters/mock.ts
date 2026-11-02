import type { CandidateLine, LineJudge, Moderation, MusicClip, MusicProvider, SceneArtist, SceneSpec, Voice } from './types.js';
import { fallbackScene } from '../scenes.js';

export class MockLineJudge implements LineJudge {
  async choose(lines: CandidateLine[], _songSoFar: CandidateLine[] = [], _style = 'pop', _mood = 'playful'): Promise<CandidateLine[]> {
    return lines.slice(0, 4);
  }
  async title(lines: CandidateLine[]): Promise<string> {
    return lines.length ? lines[0]!.text.split(/\s+/).slice(0, 4).join(' ') : 'The Chat Song';
  }
}

export class MockModeration implements Moderation {
  async check(text: string): Promise<'ok' | 'blocked'> {
    return text.trim().length ? 'ok' : 'blocked';
  }
}

export class MockMusicProvider implements MusicProvider {
  async render(_style: string, lines: CandidateLine[], _mood = 'playful', _release = false): Promise<MusicClip> {
    const words = lines.flatMap((line) => line.text.split(/\s+/));
    const durationSec = Math.max(4, words.length * 0.42);
    return {
      audioUrl: `/media/mock-tone.wav?duration=${durationSec}`,
      durationSec,
      lineTimings: lines.map((line, index) => ({ text: line.text, start: durationSec * index / Math.max(lines.length, 1), end: durationSec * (index + 1) / Math.max(lines.length, 1) })),
      words: words.map((word, index) => ({
        word,
        start: (durationSec * index) / Math.max(words.length, 1),
        end: (durationSec * (index + 0.9)) / Math.max(words.length, 1),
      })),
    };
  }
}

export class MockSceneArtist implements SceneArtist {
  async create(line: CandidateLine, _songSoFar: CandidateLine[] = [], mood = 'day'): Promise<SceneSpec> {
    return fallbackScene(line.text, mood);
  }
}

export class MockVoice implements Voice {
  async speak(_text: string): Promise<string | null> { return null; }
}
