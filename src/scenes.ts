import { readFile } from 'node:fs/promises';
import type { CandidateLine, MascotPose, SceneMood, SceneProp, SceneSpec } from './adapters/types.js';

const moods: SceneMood[] = ['day', 'dream', 'night', 'warm', 'sea'];
const poses: MascotPose[] = ['stand', 'sit', 'walk', 'blow', 'lookup', 'puzzled', 'sleep', 'wave', 'hug', 'jump'];
const entrances = ['drop', 'grow', 'slide', 'drift', 'draw', 'pop'] as const;
const allowedTags = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop']);
const colors = new Set(['#fffaf0','#f3ecdf','#d9cfc0','#8a5a3c','#c96f4a','#f08a8a','#e3b448','#ffd23f','#7cbf6a','#5ea85a','#4f9a62','#7fd1c7','#3f8f87','#3f6fc0','#2f2a3a','#2a2622','#e8b41f','#fff','#ffffff','#000','#000000','#2f6f7a','#fff4d6','#d98a5f','#c9bfa8','none','currentColor']);
const attributeAllow = new Set(['d','fill','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','opacity','transform','cx','cy','r','rx','ry','x','y','width','height','x1','x2','y1','y2','points','viewBox','offset','stop-color','stop-opacity','gradientUnits','gradientTransform','id']);

export function sanitizeProps(input: unknown): SceneProp[] {
  if (!Array.isArray(input)) throw new Error('props must be an array');
  if (input.length > 3) throw new Error('at most three props are allowed');
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error('invalid prop');
    const prop = raw as Record<string, unknown>;
    if (typeof prop.id !== 'string' || typeof prop.svg !== 'string' || !entrances.includes(prop.enter as typeof entrances[number])) throw new Error('invalid prop fields');
    if ((prop.svg.match(/</g) ?? []).length > 30) throw new Error('prop exceeds shape limit');
    return { id: prop.id.slice(0, 48) || `prop-${index}`, enter: prop.enter as SceneProp['enter'], svg: sanitizeSvg(prop.svg) };
  });
}

export function sanitizeSvg(svg: string): string {
  if (/<\s*(script|foreignObject|image|use|iframe|style|animate|set|text|filter|mask|pattern)\b/i.test(svg)) throw new Error('SVG includes a forbidden element');
  if (/\b(?:href|xlink:href|on[a-z]+)\s*=/i.test(svg) || /url\s*\(/i.test(svg) || /javascript\s*:/i.test(svg) || /https?:/i.test(svg)) throw new Error('SVG includes a forbidden reference or attribute');
  const tags = svg.match(/<\/?[\w:-]+\b[^>]*>/g) ?? [];
  if (!tags.length || !/^\s*<g(?:\s|>)/i.test(svg) || !/<\/g>\s*$/i.test(svg.trim())) throw new Error('prop SVG must be a group');
  for (const tag of tags) {
    const name = tag.match(/^<\/?([\w:-]+)/)?.[1];
    if (!name || !allowedTags.has(name)) throw new Error(`SVG element ${name ?? ''} is not allowed`);
    if (tag.startsWith('</')) continue;
    const attrs = [...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)];
    const rest = tag.replace(/^<\/?[\w:-]+/, '').replace(/\s+[\w:-]+\s*=\s*(["']).*?\1/g, '').replace(/[\s/>]/g, '');
    if (rest) throw new Error('malformed SVG attributes');
    for (const [, key, , value] of attrs) {
      if (!attributeAllow.has(key!)) throw new Error(`SVG attribute ${key} is not allowed`);
      if (key === 'fill' || key === 'stroke' || key === 'stop-color') if (!colors.has(value!.toLowerCase())) throw new Error(`SVG color ${value} is outside the palette`);
      if (/url\(|javascript:|https?:/i.test(value!)) throw new Error('SVG contains an external reference');
      if (['x','y','x1','x2','y1','y2','cx','cy'].includes(key!)) {
        const number = Number(value); if (Number.isFinite(number) && (number < -50 || number > 850)) throw new Error('SVG coordinate is outside canvas');
      }
    }
  }
  return svg.replace(/\s+/g, ' ').trim();
}

export function validateScene(raw: unknown, line: string): SceneSpec {
  if (!raw || typeof raw !== 'object') throw new Error('scene must be an object');
  const scene = raw as Record<string, any>;
  if (typeof scene.keyword !== 'string' || !line.split(/\s+/).some((word) => normalize(word) === normalize(scene.keyword))) throw new Error('keyword must come from the lyric line');
  if (!moods.includes(scene.mood)) throw new Error('invalid mood');
  if (typeof scene.ground !== 'boolean') throw new Error('ground must be boolean');
  const mascot = scene.mascot;
  if (!mascot || !poses.includes(mascot.pose) || !['left','right'].includes(mascot.facing)) throw new Error('invalid mascot pose or facing');
  if (![mascot.x, mascot.y, mascot.scale].every((n) => typeof n === 'number' && Number.isFinite(n)) || mascot.x < 0 || mascot.x > 800 || mascot.y < 150 || mascot.y > 450 || mascot.scale < 0.4 || mascot.scale > 1.5) throw new Error('mascot position/scale outside canvas');
  return { line, keyword: scene.keyword, mood: scene.mood, ground: scene.ground, mascot: { pose: mascot.pose, x: mascot.x, y: mascot.y, scale: mascot.scale, facing: mascot.facing }, props: sanitizeProps(scene.props) };
}

export function fallbackScene(line: string, mood: string): SceneSpec {
  const keyword = line.split(/\s+/).find((word) => /[\p{L}\p{N}]/u.test(word))?.replace(/[^\p{L}\p{N}'’]/gu, '') ?? 'VERSE';
  return { line, keyword, mood: moods.includes(mood as SceneMood) ? mood as SceneMood : 'day', ground: true, mascot: { pose: 'stand', x: 575, y: 370, scale: 1, facing: 'left' }, props: [] };
}

export async function claySystemPrompt(): Promise<string> { return readFile(new URL('../skills/clay-scenes/SKILL.md', import.meta.url), 'utf8'); }
function normalize(word: string): string { return word.toLowerCase().replace(/[^\p{L}\p{N}'’]/gu, ''); }
