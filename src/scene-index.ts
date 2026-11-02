import type { CandidateLine, SceneSpec } from './adapters/types.js';

export type SceneIndex = Record<string, SceneSpec>;

export function sceneKeyForLine(line: CandidateLine): string {
  return line.id ?? JSON.stringify([line.userId, line.text]);
}

export function getSceneForLine(scenes: SceneIndex, line: CandidateLine): SceneSpec | undefined {
  return scenes[sceneKeyForLine(line)];
}
