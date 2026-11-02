export type CandidateLine = { text: string; userId: string; login: string };
export type TimedWord = { word: string; start: number; end: number };
export type MusicClip = { audioUrl: string; durationSec: number; words: TimedWord[]; lineTimings?: Array<{ text: string; start: number; end: number }> };
export type SceneMood = 'day' | 'dream' | 'night' | 'warm' | 'sea';
export type MascotPose = 'stand' | 'sit' | 'walk' | 'blow' | 'lookup' | 'puzzled' | 'sleep' | 'wave' | 'hug' | 'jump';
export type SceneProp = { id: string; svg: string; enter: 'drop' | 'grow' | 'slide' | 'drift' | 'draw' | 'pop' };
export type SceneSpec = {
  line?: string; keyword: string; mood: SceneMood; ground: boolean;
  mascot: { pose: MascotPose; x: number; y: number; scale: number; facing: 'left' | 'right' };
  props: SceneProp[];
};

export interface LineJudge {
  choose(lines: CandidateLine[], songSoFar: CandidateLine[], style: string, mood?: string): Promise<CandidateLine[]>;
  title?(lines: CandidateLine[], style: string, mood: string): Promise<string>;
}
export interface Moderation { check(text: string): Promise<'ok' | 'blocked'> }
export interface MusicProvider {
  render(style: string, lines: CandidateLine[], mood?: string, release?: boolean): Promise<MusicClip>;
}
export interface SceneArtist { create(line: CandidateLine, songSoFar: CandidateLine[], mood: string): Promise<SceneSpec> }
export interface Voice { speak(text: string): Promise<string | null> }
