import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CandidateLine, LineJudge, Moderation, MusicClip, MusicProvider, SceneArtist, SceneSpec, TimedWord, Voice } from './types.js';
import { MockLineJudge, MockModeration, MockMusicProvider, MockSceneArtist, MockVoice } from './mock.js';
import { config } from '../config.js';
import { claySystemPrompt, fallbackScene, validateScene } from '../scenes.js';

function warn(name: string, error: unknown): void {
  console.warn(`[${name}] falling back to mock:`, error instanceof Error ? error.message : error);
}

export class OpenCompatibleJudge implements LineJudge {
  constructor(private readonly apiKey = config.llmApiKey, private readonly baseUrl = config.llmBaseUrl, private readonly model = config.llmModel) {}

  async choose(lines: CandidateLine[], songSoFar: CandidateLine[], style: string, mood = 'playful'): Promise<CandidateLine[]> {
    if (!this.apiKey) return new MockLineJudge().choose(lines, songSoFar, style);
    try {
      const allowed = new Map(lines.map((line) => [line.text, line]));
      if (!lines.length) return [];
      const content = await this.chat('Select up to four candidates. Never invent or rewrite a line; return exact candidate strings only. Rank by rhythm, rhyme, fit with the existing song, style and mood. Humor is welcome. Return JSON object {"lines":[...]} and no other fields.', { candidates: lines.map((line) => line.text), song_so_far: songSoFar.map((line) => line.text), style, mood });
      const parsed = JSON.parse(content) as { lines?: unknown };
      if (!Array.isArray(parsed.lines)) throw new Error('LineJudge JSON omitted lines array');
      const seen = new Set<string>();
      return parsed.lines.flatMap((item) => {
        if (typeof item !== 'string' || !allowed.has(item) || seen.has(item)) return [];
        seen.add(item); return [allowed.get(item)!];
      }).slice(0, 4);
    } catch (error) { warn('LineJudge', error); return new MockLineJudge().choose(lines); }
  }

  async title(lines: CandidateLine[], style: string, mood: string): Promise<string> {
    if (!this.apiKey) return fallbackTitle(lines);
    try {
      const content = await this.chat('Write a short, memorable song title based on these lyrics. Return JSON object {"title":"..."}.', { lines: lines.map((line) => line.text), style, mood });
      const value = (JSON.parse(content) as { title?: unknown }).title;
      if (typeof value !== 'string' || !value.trim()) throw new Error('Title JSON omitted title');
      return value.trim().slice(0, 80);
    } catch (error) { warn('Title', error); return fallbackTitle(lines); }
  }

  private async chat(instructions: string, input: unknown): Promise<string> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(input) }] }),
    });
    if (!response.ok) throw new Error(`Chat completion returned ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Chat completion returned no content');
    return content;
  }
}

export class LlmSceneArtist implements SceneArtist {
  constructor(private readonly apiKey = config.llmApiKey, private readonly baseUrl = config.llmBaseUrl, private readonly model = config.sceneModel) {}
  async create(line: CandidateLine, songSoFar: CandidateLine[], mood: string): Promise<SceneSpec> {
    if (!this.apiKey) return new MockSceneArtist().create(line, songSoFar, mood);
    const system = await claySystemPrompt();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const content = await this.chat(`${system}\nReturn only the scene spec JSON object. Props must use palette colors only and simple SVG groups within the 800x450 viewBox.`, { lyric: line.text, song_so_far: songSoFar.map((item) => item.text), mood, retry: attempt > 0 ? 'Previous response was invalid. Return a valid schema and safe SVG.' : undefined });
        return validateScene(JSON.parse(content), line.text, mood);
      } catch (error) { if (attempt === 0) console.warn('[SceneArtist] invalid scene; retrying:', error instanceof Error ? error.message : error); }
    }
    console.warn('[SceneArtist] using simple fallback scene');
    return fallbackScene(line.text, mood);
  }
  private async chat(instructions: string, input: unknown): Promise<string> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(input) }] }) });
    if (!response.ok) throw new Error(`Chat completion returned ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Chat completion returned no content');
    return content;
  }
}

function fallbackTitle(lines: CandidateLine[]): string {
  const words = lines.flatMap((line) => line.text.split(/\s+/)).slice(0, 4);
  return words.length ? words.join(' ').replace(/[.!?,]+$/g, '') : 'The Chat Song';
}

const BLOCKLIST = ['slurword1', 'slurword2'];
export class RealModeration implements Moderation {
  constructor(private readonly apiKey = config.openAiApiKey, private readonly provider = config.moderationProvider) {}
  async check(text: string): Promise<'ok' | 'blocked'> {
    const local = localCheck(text);
    if (local === 'blocked' || this.provider === 'none' || !this.apiKey) return local;
    try {
      const response = await fetch('https://api.openai.com/v1/moderations', { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'omni-moderation-latest', input: text }) });
      if (!response.ok) throw new Error(`Moderation returned ${response.status}`);
      const data = await response.json() as { results?: Array<{ flagged?: boolean }> };
      return data.results?.[0]?.flagged ? 'blocked' : 'ok';
    } catch (error) { warn('Moderation', error); return local; }
  }
}

function localCheck(text: string): 'ok' | 'blocked' {
  const normalized = text.trim();
  if (!normalized || normalized.length > 80 || /https?:\/\/|www\.|\b\w+\.(com|gg|net|org)\b/i.test(normalized)) return 'blocked';
  if (/\b(\w+)(?:\s+\1){3,}/i.test(normalized)) return 'blocked';
  if (BLOCKLIST.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(normalized))) return 'blocked';
  return 'ok';
}

type PascalArtifact = { name?: string; content_type?: string; url?: string };
type PascalJob = { id: string; status: string; result?: { artifacts?: PascalArtifact[]; lyrics_lines?: Array<{ text: string; start: number; end?: number }> }; playback_url?: string; error_code?: string; error_message?: string };
class PascalFailure extends Error { constructor(readonly errorCode:string,readonly jobId:string|undefined,message:string){super(message);this.name='PascalFailure';} }
type PascalModels = Array<{ id?: string; name?: string; parameters_schema?: Record<string, unknown> }>;
export class PascalProvider implements MusicProvider {
  constructor(private readonly apiKey = config.pascalApiKey, private readonly baseUrl = config.pascalBaseUrl, private readonly wait = (ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms))) {}

  async render(style: string, lines: CandidateLine[], mood = 'playful', release = false, strict = false, onRetry?: (attempt: number, delayMs: number) => void): Promise<MusicClip> {
    if (!this.apiKey) return new MockMusicProvider().render(style, lines, mood, release);
    const delays=[3000,8000];let lastError:unknown;
    for(let attempt=0;attempt<3;attempt+=1){
      try{return await this.renderReal(style,lines,mood,release,strict);}
      catch(error){lastError=error;const detail=error instanceof PascalFailure?error:new PascalFailure('request_failed',undefined,error instanceof Error?error.message:String(error));console.error(`[Pascal music] attempt=${attempt+1} error_code=${detail.errorCode} job_id=${detail.jobId??'unknown'} message=${detail.message}`);if(attempt<2){onRetry?.(attempt+1,delays[attempt]!);await this.wait(delays[attempt]!);}}
    }
    throw lastError instanceof Error?lastError:new Error('Pascal music render failed');
  }

  private async renderReal(style: string, lines: CandidateLine[], mood: string, release: boolean, strict: boolean): Promise<MusicClip> {
    const lyrics = formatLyrics(lines, strict);
    const model = release ? config.pascalReleaseModel : config.pascalMusicModel;
    const long = release;
    const descriptor = config.genres[style] ?? `${style} music`;
    const prompt = `${style}, ${descriptor}, ${mood}; sing only the supplied lyrics exactly as written and in order. Do not add, repeat, paraphrase, or invent words, verses, hooks, or vocalizations. No new lyrics. Vocals start immediately; an instrumental outro is allowed.${strict?' Strict take: perform only the exact supplied lines, once each, in order; no ad-libs or extra vocals.':''}`;
    const duration = long ? 30 : 10;
    const job = await this.requestJson<PascalJob>('/music', { model, prompt, lyrics, duration_seconds: duration, bpm: 100 });
    const finished = await this.pollJob(job);
    const artifact = finished.result?.artifacts?.find((item) => item.content_type?.startsWith('audio/')) ?? finished.result?.artifacts?.[0];
    const url = artifact?.url ?? finished.playback_url;
    if (!url) throw new PascalFailure('no_audio',finished.id,'Pascal job completed without an audio artifact URL');
    const bytesResponse = await fetch(url);
    if (!bytesResponse.ok) throw new PascalFailure(`audio_download_${bytesResponse.status}`,finished.id,`Audio download returned ${bytesResponse.status}`);
    const bytes = Buffer.from(await bytesResponse.arrayBuffer());
    const ext = artifact?.content_type?.includes('wav') ? '.wav' : artifact?.content_type?.includes('mpeg') ? '.mp3' : '.audio';
    const fileName = `${randomUUID()}${ext}`;
    const mediaDir = resolve('data/media'); await mkdir(mediaDir, { recursive: true });
    await writeFile(resolve(mediaDir, fileName), bytes);
    const durationSec = await measureDuration(bytes, ext, resolve(mediaDir, fileName));
    const lyricsLines = alignLyricLines(lines, finished.result?.lyrics_lines, durationSec);
    const words = lyricsLines.flatMap((line) => spreadLineWords(line.text, line.start, line.end));
    const timings = await this.transcribe(bytes, fileName, ext).catch((error) => { console.error(`[Pascal ASR] error_code=transcription_failed job_id=${finished.id}:`, error); return null; });
    const fidelityScore = scoreSungFidelity(lines, timings ?? []);
    console.info(`[Music fidelity] job_id=${finished.id} score=${fidelityScore.toFixed(3)} strict=${strict}`);
    const sungSegments=(finished.result?.lyrics_lines??[]).map((item,index,all)=>({text:item.text,start:item.start,end:item.end??all[index+1]?.start??durationSec}));
    return { audioUrl: `/media/${fileName}`, durationSec, lineTimings: lyricsLines, sungSegments, words: refineTimings(words, timings), fidelityScore, isMock:false };
  }

  private async pollJob(initial: PascalJob): Promise<PascalJob> {
    let job = initial;
    if (job.status === 'failed') throw new PascalFailure(job.error_code??'failed',job.id,job.error_message??'Pascal job failed');
    for (let i = 0; job.status !== 'succeeded' && i < 120; i += 1) {
      if (!job.id) throw new Error('Pascal returned an incomplete job object');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
      job = await this.requestJson<PascalJob>(`/jobs/${encodeURIComponent(job.id)}`);
      if (job.status === 'failed') throw new PascalFailure(job.error_code??'failed',job.id,job.error_message??'Pascal job failed');
    }
    if (job.status !== 'succeeded') throw new PascalFailure('job_timeout',job.id,'Pascal job timed out');
    return job;
  }

  private async transcribe(bytes: Buffer, fileName: string, ext: string): Promise<TimedWord[] | null> {
    const form = new FormData();
    form.set('model', config.pascalAsrModel);
    form.set('params', JSON.stringify({ timestamp_granularity: 'word', response_format: 'verbose_json', language: 'auto' }));
    form.set('file', new File([new Uint8Array(bytes)], fileName, { type: ext === '.wav' ? 'audio/wav' : 'audio/mpeg' }));
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/speech-to-text`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}` }, body: form });
    if (!response.ok) throw new Error(`Pascal ASR returned ${response.status}`);
    const data = await response.json() as { result?: { words?: TimedWord[] }; words?: TimedWord[] };
    return data.result?.words ?? data.words ?? null;
  }

  private async requestJson<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new PascalFailure(`http_${response.status}`,undefined,`Pascal ${path} returned ${response.status}`);
    return await response.json() as T;
  }

  async speak(text: string): Promise<string | null> {
    if (!this.apiKey || !config.pascalTtsModel) return new MockVoice().speak(text);
    try {
      const models = await this.getModels();
      const model = models.find((item) => (item.id ?? item.name) === config.pascalTtsModel || (item as { model?: string }).model === config.pascalTtsModel);
      if (!model?.parameters_schema) throw new Error(`No parameters_schema found for TTS model ${config.pascalTtsModel}`);
      const body = { model: config.pascalTtsModel, text, ...ttsParams(model.parameters_schema) };
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/text-to-speech`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`Pascal TTS returned ${response.status}`);
      const result = await response.json() as PascalJob;
      const finished = await this.pollJob(result);
      const artifact = finished.result?.artifacts?.find((item) => item.content_type?.startsWith('audio/'));
      const url = artifact?.url ?? finished.playback_url;
      if (!url) throw new Error('Pascal TTS returned no audio URL');
      const audio = await fetch(url); if (!audio.ok) throw new Error(`Pascal TTS download returned ${audio.status}`);
      const extension = audioExtension(artifact?.content_type ?? audio.headers.get('content-type') ?? '', url);
      const fileName = `${randomUUID()}${extension}`; const dir = resolve('data/media'); await mkdir(dir, { recursive: true }); await writeFile(resolve(dir, fileName), Buffer.from(await audio.arrayBuffer()));
      return `/media/${fileName}`;
    } catch (error) { warn('Pascal voice', error); return new MockVoice().speak(text); }
  }

  private async getModels(): Promise<PascalModels> {
    const response = await this.requestJson<PascalModels | { data?: PascalModels }>('/models');
    return Array.isArray(response) ? response : response.data ?? [];
  }
}

function audioExtension(contentType: string, url: string): string {
  const mime=contentType.toLowerCase().split(';')[0]?.trim();
  const byMime:Record<string,string>={'audio/mpeg':'.mp3','audio/mp3':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav','audio/ogg':'.ogg','audio/opus':'.opus','audio/webm':'.webm','audio/mp4':'.m4a','audio/aac':'.aac','audio/flac':'.flac'};
  if(mime&&byMime[mime])return byMime[mime]!;
  try{const ext=new URL(url).pathname.match(/\.(mp3|wav|ogg|opus|webm|m4a|aac|flac)$/i)?.[0].toLowerCase();if(ext)return ext;}catch{}
  return '.audio';
}

function ttsParams(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties && typeof schema.properties === 'object' ? schema.properties : schema) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(properties)) {
    if (name === 'text' || name === 'model') continue;
    const field = definition as { default?: unknown; enum?: unknown[]; type?: string };
    if ('default' in field) result[name] = field.default;
    else if (field.enum?.length) result[name] = field.enum[0];
  }
  return result;
}

export function formatLyrics(lines: CandidateLine[], _strict = false): string {
  const sections = ['[Verse 1]', '[Verse 2]', '[Bridge]', '[Verse 3]'];
  return lines.map((line, index) => `${sections[index] ?? `[Verse ${index + 1}]`}\n${line.text}`).join('\n');
}

export function scoreSungFidelity(lines:CandidateLine[],transcript:TimedWord[]):number{
  const expected=lines.flatMap(line=>line.text.split(/\s+/).map(word=>word.toLowerCase().replace(/[^\p{L}\p{N}]/gu,''))).filter(Boolean);
  const heard=transcript.map(item=>item.word.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')).filter(Boolean);
  if(!expected.length)return 1;const previous=new Uint32Array(heard.length+1),current=new Uint32Array(heard.length+1);
  for(const word of expected){for(let j=1;j<=heard.length;j++)current[j]=word===heard[j-1]?previous[j-1]!+1:Math.max(previous[j]!,current[j-1]!);previous.set(current);current.fill(0);}
  return previous[heard.length]!/expected.length;
}

type LineTiming = { text: string; start: number; end: number };
export function alignLyricLines(lines: CandidateLine[], returned: Array<{ text: string; start: number; end?: number }> | undefined, duration: number): LineTiming[] {
  if (!lines.length) return [];
  const entries=(returned??[]).filter(item=>Number.isFinite(item.start)&&normalize(item.text));
  const matches: Array<{start:number;end?:number;entryIndex?:number}|undefined>=[];let cursor=0;
  for(const line of lines){let bestIndex=-1,bestScore=0;for(let i=cursor;i<entries.length;i++){const score=similarity(normalize(line.text),normalize(entries[i]!.text));if(score>bestScore){bestScore=score;bestIndex=i;}}if(bestIndex>=0&&bestScore>=0.7){matches.push({...entries[bestIndex],entryIndex:bestIndex});cursor=bestIndex+1;}else matches.push(undefined);}
  const anchors=matches.map((item,index)=>item?{index,start:clamp(item.start,0,duration)}:null).filter((item):item is {index:number;start:number}=>item!==null);
  for(let i=0;i<matches.length;i++){if(matches[i])continue;const previous=[...anchors].reverse().find(anchor=>anchor.index<i);const next=anchors.find(anchor=>anchor.index>i);const left=previous?.start??0;const right=next?.start??duration;const leftIndex=previous?.index??-1;const rightIndex=next?.index??lines.length;const fraction=(i-leftIndex)/(rightIndex-leftIndex);matches[i]={start:clamp(left+(right-left)*fraction,0,duration)};}
  return lines.map((line,index)=>{const item=matches[index]!;const start=clamp(item.start,0,duration);const next=matches[index+1];const nextStart=next?clamp(next.start,start,duration):duration;const nextReturned=item.entryIndex===undefined?undefined:entries[item.entryIndex+1]?.start;return{text:line.text,start,end:clamp(item.end??nextReturned??nextStart,start,duration)};});
}

function similarity(a:string,b:string):number{if(!a||!b)return 0;const rows=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i===0?j:j===0?i:0));for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)rows[i]![j]=Math.min(rows[i-1]![j]!+1,rows[i]![j-1]!+1,rows[i-1]![j-1]!+(a[i-1]===b[j-1]?0:1));return 1-rows[a.length]![b.length]!/Math.max(a.length,b.length);}

function spreadLineWords(text: string, start: number, end: number): TimedWord[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.map((word, index) => ({ word, start: start + (end - start) * index / words.length, end: start + (end - start) * (index + 0.9) / words.length }));
}

function refineTimings(lyrics: TimedWord[], asr: TimedWord[] | null): TimedWord[] {
  if (!asr?.length) return lyrics;
  const result: TimedWord[] = [];
  let cursor = 0;
  for (const word of lyrics) {
    const match = asr.slice(cursor, cursor + 3).findIndex((candidate) => normalize(candidate.word) === normalize(word.word));
    if (match < 0) return lyrics;
    const candidate = asr[cursor + match]!;
    if (candidate.start < word.start - 1.5 || candidate.start > word.end + 1.5) return lyrics;
    result.push({ word: word.word, start: candidate.start, end: candidate.end }); cursor += match + 1;
  }
  return result;
}

function normalize(text: string): string { return text.toLowerCase().replace(/[^\p{L}\p{N}'’]/gu, ''); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

export async function measureDuration(bytes: Buffer, ext: string, existingPath?: string): Promise<number> {
  if (ext === '.wav' && bytes.length > 44) {
    const dataSize = bytes.readUInt32LE(40); const byteRate = bytes.readUInt32LE(28);
    if (byteRate > 0) return dataSize / byteRate;
  }
  const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const filePath = existingPath ?? resolve('data/media', `${randomUUID()}${ext}`);
  if (!existingPath) await writeFile(filePath, bytes);
  try {
    const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('ffprobe returned an invalid duration');
    return duration;
  } finally { if (!existingPath) { const { unlink } = await import('node:fs/promises'); await unlink(filePath).catch(() => undefined); } } // only remove the temp copy, never the saved song
}
