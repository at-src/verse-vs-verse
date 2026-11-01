export type CandidateLine = { text: string; userId: string; login: string };
export type TimedWord = { word: string; start: number; end: number };
export type MusicClip = { audioUrl: string; durationSec: number; words: TimedWord[] };
export type SceneSpec = { backdrop: string; mascotPose: string; keyword: string; propsSvg: string };

export interface LineJudge {
  choose(lines: CandidateLine[], songSoFar: CandidateLine[], style: string, mood?: string): Promise<CandidateLine[]>;
  title?(lines: CandidateLine[], style: string, mood: string): Promise<string>;
}
export interface Moderation { check(text: string): Promise<'ok' | 'blocked'> }
export interface MusicProvider {
  render(style: string, lines: CandidateLine[], mood?: string, release?: boolean): Promise<MusicClip>;
}
export interface SceneArtist { create(line: CandidateLine, mood: string): Promise<SceneSpec> }
export interface Voice { speak(text: string): Promise<string | null> }
