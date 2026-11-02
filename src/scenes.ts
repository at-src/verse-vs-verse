import { readFile } from 'node:fs/promises';
import type { CandidateLine, MascotPose, SceneMood, SceneProp, SceneSpec } from './adapters/types.js';

const moods: SceneMood[] = ['day', 'dream', 'night', 'warm', 'sea'];
const poses: MascotPose[] = ['stand', 'sit', 'walk', 'blow', 'lookup', 'puzzled', 'sleep', 'wave', 'hug', 'jump'];
const entrances = ['drop', 'grow', 'slide', 'drift', 'draw', 'pop'] as const;
const allowedTags = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop']);
const palette = ['#fffaf0','#f3ecdf','#d9cfc0','#8a5a3c','#c96f4a','#f08a8a','#e3b448','#ffd23f','#7cbf6a','#5ea85a','#4f9a62','#7fd1c7','#3f8f87','#3f6fc0','#2f2a3a','#2a2622','#e8b41f','#2f6f7a','#fff4d6','#d98a5f','#c9bfa8'];
const attributeAllow = new Set(['d','fill','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','opacity','transform','cx','cy','r','rx','ry','x','y','width','height','x1','x2','y1','y2','points','viewBox','offset','stop-color','stop-opacity','gradientUnits','gradientTransform','id']);

export function sanitizeProps(input: unknown): SceneProp[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 3).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const prop = raw as Record<string, unknown>;
    if (typeof prop.svg !== 'string') return [];
    let svg: string;
    try { svg = sanitizeSvg(prop.svg); } catch { return []; }
    if (!svg) return [];
    if (!/<(?:path|circle|ellipse|rect|line|polyline|polygon)\b/i.test(svg)) return [];
    if ((svg.match(/</g) ?? []).length > 30) return [];
    const enter = entrances.includes(prop.enter as typeof entrances[number]) ? prop.enter as SceneProp['enter'] : 'pop';
    return [{ id: typeof prop.id === 'string' ? prop.id.slice(0,48) || `prop-${index}` : `prop-${index}`, enter, svg }];
  });
}

export function sanitizeSvg(svg: string): string {
  const safeInput = svg.replace(/<\s*(script|foreignObject)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '').replace(/<\s*(script|foreignObject|image)\b[^>]*\/?>/gi, '');
  const tags = safeInput.match(/<\/?[\w:-]+\b[^>]*>/g) ?? [];
  if (!tags.length || !/^\s*<g(?:\s|>)/i.test(safeInput)) return '';
  let cleaned = '';
  for (const tag of tags) {
    const name = tag.match(/^<\/?([\w:-]+)/)?.[1];
    if (!name || !allowedTags.has(name)) continue;
    if (tag.startsWith('</')) { cleaned += tag; continue; }
    const attrs = [...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)];
    const rest = tag.replace(/^<\/?[\w:-]+/, '').replace(/\s+[\w:-]+\s*=\s*(["']).*?\1/g, '').replace(/[\s/>]/g, '');
    if (rest) continue;
    let safeTag = `<${name}`;
    for (const [, key, , value] of attrs) {
      if (!attributeAllow.has(key!)) continue;
      if (/^on[a-z]+$/i.test(key!)) continue;
      let repaired = value!;
      if (key === 'fill' || key === 'stroke' || key === 'stop-color') repaired = snapColor(value!);
      if (/url\(|javascript:|https?:/i.test(repaired)) continue;
      if (['x','y','x1','x2','y1','y2','cx','cy'].includes(key!)) {
        const number = Number(value); if (Number.isFinite(number)) repaired = String(Math.max(-50,Math.min(850,number)));
      }
      safeTag += ` ${key}="${escapeAttr(repaired)}"`;
    }
    cleaned += safeTag + (tag.endsWith('/>') ? '/>' : '>');
  }
  if (!/<\/g>\s*$/.test(cleaned.trim())) cleaned += '</g>';
  return cleaned;
}

export function validateScene(raw: unknown, line: string, requestedMood = 'day'): SceneSpec {
  if (!raw || typeof raw !== 'object') throw new Error('scene must be an object');
  const scene = raw as Record<string, any>;
  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('no lyric words available');
  const repairedMood = moods.includes(scene.mood) ? scene.mood : moods.includes(requestedMood as SceneMood) ? requestedMood as SceneMood : 'day';
  const keyword = closestWord(typeof scene.keyword === 'string' ? scene.keyword : '', words);
  const rawMascot = scene.mascot && typeof scene.mascot === 'object' ? scene.mascot : {};
  const numeric = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const mascot = { pose: poses.includes(rawMascot.pose) ? rawMascot.pose : 'stand', x: clamp(numeric(rawMascot.x, 580), 55, 745), y: clamp(numeric(rawMascot.y, 360), 150, 450), scale: clamp(numeric(rawMascot.scale, 1), 0.4, 1.5), facing: rawMascot.facing === 'left' ? 'left' : 'right' };
  return { line, keyword, mood: repairedMood, ground: typeof scene.ground === 'boolean' ? scene.ground : true, mascot: mascot as SceneSpec['mascot'], props: sanitizeProps(Array.isArray(scene.props) ? scene.props.slice(0, 3) : []) };
}

export function fallbackScene(line: string, mood: string): SceneSpec {
  const words=line.split(/\s+/).filter((word)=>/[\p{L}\p{N}]/u.test(word));
  const stop=new Set(['my','we','the','a','is','at','in','on','with','i','you','and','to','of','it','our','this','that','be','are','was','for']);
  const keyword=(words.find(word=>!stop.has(normalize(word)))??words[0]??'VERSE').replace(/[^\p{L}\p{N}'’]/gu,'');
  return { line, keyword, mood: moods.includes(mood as SceneMood) ? mood as SceneMood : 'day', ground: true, mascot: { pose: 'stand', x: 575, y: 370, scale: 1, facing: 'left' }, props: [] };
}

export async function claySystemPrompt(): Promise<string> { return readFile(new URL('../skills/clay-scenes/SKILL.md', import.meta.url), 'utf8'); }
function normalize(word: string): string { return word.toLowerCase().replace(/[^\p{L}\p{N}'’]/gu, ''); }
function snapColor(color:string):string{
  const lower=color.trim().toLowerCase();if(lower==='none'||lower==='currentcolor')return lower;
  const names:Record<string,string>={red:'#ff0000',orange:'#ffa500',yellow:'#ffff00',green:'#008000',lime:'#00ff00',blue:'#0000ff',navy:'#000080',purple:'#800080',violet:'#ee82ee',pink:'#ffc0cb',coral:'#ff7f50',gold:'#ffd700',brown:'#a52a2a',black:'#000000',white:'#ffffff',gray:'#808080',grey:'#808080'};
  const value=names[lower]??lower;const short=value.match(/^#([0-9a-f]{3})$/i)?.[1];const hex=short?short.split('').map(char=>char+char).join(''):value.match(/^#([0-9a-f]{6})$/i)?.[1];
  const rgbMatch=value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  const target=hex?[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)):rgbMatch?rgbMatch.slice(1,4).map(component=>clamp(Number(component),0,255)):null;
  if(!target)return'#d9cfc0';let best=palette[0]!;let score=Infinity;for(const candidate of palette){const candidateRgb=[1,3,5].map(index=>parseInt(candidate.slice(index,index+2),16));const distance=candidateRgb.reduce((sum,component,index)=>sum+(component-target[index]!)**2,0);if(distance<score){score=distance;best=candidate;}}return best;
}
function escapeAttr(value:string):string{return value.replace(/[&"<>]/g,char=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[char]!));}
function closestWord(keyword:string,words:string[]):string{const normalized=normalize(keyword);if(!normalized)return words.sort((a,b)=>b.length-a.length)[0]!;return words.reduce((best,word)=>similarity(normalized,normalize(word))>similarity(normalized,normalize(best))?word:best,words[0]!);}
function similarity(a:string,b:string):number{const rows=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i===0?j:j===0?i:0));for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)rows[i]![j]=Math.min(rows[i-1]![j]!+1,rows[i]![j-1]!+1,rows[i-1]![j-1]!+(a[i-1]===b[j-1]?0:1));return 1-rows[a.length]![b.length]!/Math.max(a.length,b.length,1);}
function clamp(value:number,min:number,max:number):number{return Math.max(min,Math.min(max,value));}
