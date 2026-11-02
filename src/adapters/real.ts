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
  constructor(private readonly apiKey = config.llmApiKey, private readonly baseUrl = config.llmBaseUrl, private readonly model = config.llmModel) {}
  async create(line: CandidateLine, songSoFar: CandidateLine[], mood: string): Promise<SceneSpec> {
    if (!this.apiKey) return new MockSceneArtist().create(line, songSoFar, mood);
    const system = await claySystemPrompt();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const content = await this.chat(`${system}\nReturn only the scene spec JSON object. Props must use palette colors only and simple SVG groups within the 800x450 viewBox.`, { lyric: line.text, song_so_far: songSoFar.map((item) => item.text), mood, retry: attempt > 0 ? 'Previous response was invalid. Return a valid schema and safe SVG.' : undefined });
        return validateScene(JSON.parse(content), line.text);
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
type PascalModels = Array<{ id?: string; name?: string; parameters_schema?: Record<string, unknown> }>;
export class PascalProvider implements MusicProvider {
  constructor(private readonly apiKey = config.pascalApiKey, private readonly baseUrl = config.pascalBaseUrl) {}

  async render(style: string, lines: CandidateLine[], mood = 'playful', release = false): Promise<MusicClip> {
    if (!this.apiKey) return new MockMusicProvider().render(style, lines, mood, release);
    try { return await this.renderReal(style, lines, mood, release); }
    catch (error) { warn('Pascal music', error); return new MockMusicProvider().render(style, lines, mood, release); }
  }

  private async renderReal(style: string, lines: CandidateLine[], mood: string, release: boolean): Promise<MusicClip> {
    const lyrics = formatLyrics(lines);
    const model = release ? config.pascalReleaseModel : config.pascalMusicModel;
    const long = release;
    const descriptor = config.genres[style] ?? `${style} music`;
    const prompt = `${style}, ${descriptor}, ${mood}; vocals start immediately, no long intro`;
    const duration = long ? 30 : 10;
    const job = await this.requestJson<PascalJob>('/music', { model, prompt, lyrics, duration_seconds: duration, bpm: 100 });
    const finished = await this.pollJob(job);
    const artifact = finished.result?.artifacts?.find((item) => item.content_type?.startsWith('audio/')) ?? finished.result?.artifacts?.[0];
    const url = artifact?.url ?? finished.playback_url;
    if (!url) throw new Error('Pascal job completed without an audio artifact URL');
    const bytesResponse = await fetch(url);
    if (!bytesResponse.ok) throw new Error(`Audio download returned ${bytesResponse.status}`);
    const bytes = Buffer.from(await bytesResponse.arrayBuffer());
    const ext = artifact?.content_type?.includes('wav') ? '.wav' : artifact?.content_type?.includes('mpeg') ? '.mp3' : '.audio';
    const fileName = `${randomUUID()}${ext}`;
    const mediaDir = resolve('data/media'); await mkdir(mediaDir, { recursive: true });
    await writeFile(resolve(mediaDir, fileName), bytes);
    const durationSec = await measureDuration(bytes, ext, resolve(mediaDir, fileName));
    const lyricsLines = alignLyricLines(lines, finished.result?.lyrics_lines, durationSec);
    const words = lyricsLines.flatMap((line) => spreadLineWords(line.text, line.start, line.end));
    const timings = await this.transcribe(bytes, fileName, ext).catch((error) => { warn('Pascal ASR', error); return null; });
    return { audioUrl: `/media/${fileName}`, durationSec, lineTimings: lyricsLines, words: refineTimings(words, timings) };
  }

  private async pollJob(initial: PascalJob): Promise<PascalJob> {
    let job = initial;
    if (job.status === 'failed') throw new Error(`${job.error_code ?? 'failed'}: ${job.error_message ?? 'Pascal job failed'}`);
    for (let i = 0; job.status !== 'succeeded' && i < 120; i += 1) {
      if (!job.id) throw new Error('Pascal returned an incomplete job object');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
      job = await this.requestJson<PascalJob>(`/jobs/${encodeURIComponent(job.id)}`);
      if (job.status === 'failed') throw new Error(`${job.error_code ?? 'failed'}: ${job.error_message ?? 'Pascal job failed'}`);
    }
    if (job.status !== 'succeeded') throw new Error('Pascal job timed out');
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
    if (!response.ok) throw new Error(`Pascal ${path} returned ${response.status}`);
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
      const url = finished.result?.artifacts?.find((item) => item.content_type?.startsWith('audio/'))?.url ?? finished.playback_url;
      if (!url) throw new Error('Pascal TTS returned no audio URL');
      const audio = await fetch(url); if (!audio.ok) throw new Error(`Pascal TTS download returned ${audio.status}`);
      const fileName = `${randomUUID()}.mp3`; const dir = resolve('data/media'); await mkdir(dir, { recursive: true }); await writeFile(resolve(dir, fileName), Buffer.from(await audio.arrayBuffer()));
      return `/media/${fileName}`;
    } catch (error) { warn('Pascal voice', error); return new MockVoice().speak(text); }
  }

  private async getModels(): Promise<PascalModels> {
    const response = await this.requestJson<PascalModels | { data?: PascalModels }>('/models');
    return Array.isArray(response) ? response : response.data ?? [];
  }
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

export function formatLyrics(lines: CandidateLine[]): string {
  const sections = ['[Verse 1]', '[Chorus]', '[Verse 2]', '[Bridge]'];
  return lines.map((line, index) => `${index >= sections.length ? '[Chorus]' : sections[index]}\n${line.text}`).join('\n');
}

type LineTiming = { text: string; start: number; end: number };
export function alignLyricLines(lines: CandidateLine[], returned: Array<{ text: string; start: number; end?: number }> | undefined, duration: number): LineTiming[] {
  if (!lines.length) return [];
  const matched = lines.map((line) => returned?.find((item) => normalize(item.text) === normalize(line.text)));
  const usable = matched.every((item) => item && Number.isFinite(item.start));
  if (!usable) return lines.map((line, index) => ({ text: line.text, start: duration * index / lines.length, end: duration * (index + 1) / lines.length }));
  return lines.map((line, index) => {
    const item = matched[index]!;
    const start = clamp(item.start, 0, duration);
    const nextStart = matched[index + 1] ? clamp(matched[index + 1]!.start, start, duration) : duration;
    return { text: line.text, start, end: clamp(item.end ?? nextStart, start, duration) };
  });
}

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
