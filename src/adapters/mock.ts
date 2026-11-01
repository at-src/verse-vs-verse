import type { CandidateLine, LineJudge, Moderation, MusicClip, MusicProvider, SceneArtist, SceneSpec, Voice } from './types.js';

export class MockLineJudge implements LineJudge {
  async choose(lines: CandidateLine[]): Promise<CandidateLine[]> {
    return lines.slice(0, 4);
  }
}

export class MockModeration implements Moderation {
  async check(text: string): Promise<'ok' | 'blocked'> {
    return text.trim().length ? 'ok' : 'blocked';
  }
}

export class MockMusicProvider implements MusicProvider {
  async render(_style: string, lines: CandidateLine[]): Promise<MusicClip> {
    const words = lines.flatMap((line) => line.text.split(/\s+/));
    const durationSec = Math.max(4, words.length * 0.42);
    return {
      audioUrl: `/media/mock-tone.wav?duration=${durationSec}`,
      durationSec,
      words: words.map((word, index) => ({
        word,
        start: (durationSec * index) / Math.max(words.length, 1),
        end: (durationSec * (index + 0.9)) / Math.max(words.length, 1),
      })),
    };
  }
}

export class MockSceneArtist implements SceneArtist {
  async create(line: CandidateLine, mood: string): Promise<SceneSpec> {
    return {
      backdrop: mood,
      mascotPose: 'bounce',
      keyword: line.text.split(/\s+/)[0] ?? 'verse',
      propsSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 120"><path d="M20 90 Q90 5 160 90Z" fill="#f5bd75" stroke="#553b56" stroke-width="6"/><circle cx="90" cy="62" r="12" fill="#553b56"/></svg>',
    };
  }
}

export class MockVoice implements Voice {
  async speak(): Promise<string | null> { return null; }
}
