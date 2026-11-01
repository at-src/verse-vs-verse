import { randomUUID } from 'node:crypto';
import type { CandidateLine, LineJudge, Moderation, MusicProvider, SceneArtist, SceneSpec, Voice, MusicClip } from './adapters/types.js';
export type { CandidateLine } from './adapters/types.js';

export type Phase = 'IDLE' | 'WRITE' | 'SHORTLIST' | 'VOTE' | 'PRODUCE' | 'PLAY' | 'RELEASE';
export type RoundEvent =
  | { type: 'STATE'; state: RoundState }
  | { type: 'CHAT_LINE'; line: CandidateLine }
  | { type: 'VOTE_TALLY'; counts: number[] }
  | { type: 'SCENE'; line: CandidateLine; scene: SceneSpec }
  | { type: 'CLIP'; clip: MusicClip }
  | { type: 'SAVED'; songId: string };
export type RoundState = {
  phase: Phase; round: number; roundsPerSong: number; style: string; mood: string;
  deadline: number | null; lines: CandidateLine[]; shortlist: CandidateLine[]; votes: number[];
  song: CandidateLine[]; clip: MusicClip | null; scenes: SceneSpec[]; title: string;
};
type EngineOptions = {
  writeSeconds: number; voteSeconds: number; roundsPerSong: number; maxSongsPerHour: number; releaseSeconds?: number;
  channelId: string; channelLogin: string; judge: LineJudge; moderation: Moderation;
  music: MusicProvider; artist: SceneArtist; voice: Voice;
  now?: () => number; broadcast?: (event: RoundEvent) => void;
  saveSong?: (song: { id: string; channelId: string; title: string; style: string; createdAt: number; clip: MusicClip; lines: CandidateLine[] }) => void;
};

const LINK_OR_EMOTE = /(https?:\/\/\S+|www\.\S+|\b\w+\.com\b|\b\w+\.gg\b)/i;

export class RoundEngine {
  private readonly now: () => number;
  private readonly broadcast: (event: RoundEvent) => void;
  private readonly songTimes: number[] = [];
  private readonly usersThisHour = new Set<string>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private voteTimer: ReturnType<typeof setTimeout> | null = null;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private roundUsers = new Set<string>();
  private roundVoters = new Set<string>();
  private state: RoundState = {
    phase: 'IDLE', round: 0, roundsPerSong: 4, style: 'pop', mood: 'playful', deadline: null,
    lines: [], shortlist: [], votes: [], song: [], clip: null, scenes: [], title: 'Verse vs Verse',
  };

  constructor(private readonly options: EngineOptions) {
    this.now = options.now ?? Date.now;
    this.broadcast = options.broadcast ?? (() => undefined);
    this.state.roundsPerSong = options.roundsPerSong;
  }

  snapshot(): RoundState { return structuredClone(this.state); }

  private setPhase(phase: Phase, seconds?: number): void {
    this.state.phase = phase;
    this.state.deadline = seconds ? this.now() + seconds * 1000 : null;
    this.broadcast({ type: 'STATE', state: this.snapshot() });
  }

  async start(style = 'pop', mood = 'playful'): Promise<void> {
    if (this.state.phase !== 'IDLE' && this.state.phase !== 'RELEASE') throw new Error('A song is already in progress');
    this.clearTimers();
    const hourAgo = this.now() - 60 * 60 * 1000;
    while (this.songTimes.length && this.songTimes[0]! < hourAgo) this.songTimes.shift();
    if (this.songTimes.length >= this.options.maxSongsPerHour) throw new Error('Hourly song limit reached');
    this.songTimes.push(this.now());
    this.usersThisHour.clear();
    this.state = { ...this.state, phase: 'IDLE', round: 0, style, mood, lines: [], shortlist: [], votes: [], song: [], clip: null, scenes: [], title: 'Verse vs Verse', deadline: null };
    await this.beginWrite();
  }

  private async beginWrite(): Promise<void> {
    this.state.round += 1;
    this.roundUsers = new Set();
    this.roundVoters = new Set();
    this.state.lines = [];
    this.state.shortlist = [];
    this.state.votes = [];
    this.setPhase('WRITE', this.options.writeSeconds);
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => void this.finishWrite(), this.options.writeSeconds * 1000);
  }

  async submitLine(line: CandidateLine): Promise<boolean> {
    if (this.state.phase !== 'WRITE' || this.roundUsers.has(line.userId)) return false;
    const text = line.text.trim().replace(/\s+/g, ' ');
    if (!text || text.length > 80 || LINK_OR_EMOTE.test(text) || /\b(\w+)(?:\s+\1){3,}/i.test(text)) return false;
    if (await this.options.moderation.check(text) !== 'ok') return false;
    const accepted = { ...line, text };
    this.roundUsers.add(line.userId);
    this.state.lines.push(accepted);
    this.broadcast({ type: 'CHAT_LINE', line: accepted });
    this.broadcast({ type: 'STATE', state: this.snapshot() });
    return true;
  }

  async finishWrite(): Promise<void> {
    if (this.state.phase !== 'WRITE') return;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.setPhase('SHORTLIST');
    const shortlist = await this.options.judge.choose(this.state.lines, this.state.song, this.state.style);
    this.state.shortlist = shortlist.slice(0, 4);
    if (!this.state.shortlist.length) {
      this.state.shortlist = [{ text: 'The room is quiet, but the beat goes on', userId: 'verse-bot', login: 'versebot' }];
    }
    this.state.votes = this.state.shortlist.map(() => 0);
    this.setPhase('VOTE', this.options.voteSeconds);
    if (this.voteTimer) clearTimeout(this.voteTimer);
    this.voteTimer = setTimeout(() => void this.finishVote(), this.options.voteSeconds * 1000);
  }

  vote(userId: string, index: number): boolean {
    if (this.state.phase !== 'VOTE' || index < 0 || index >= this.state.shortlist.length || this.roundVoters.has(userId)) return false;
    this.roundVoters.add(userId);
    this.state.votes[index] = (this.state.votes[index] ?? 0) + 1;
    this.broadcast({ type: 'VOTE_TALLY', counts: [...this.state.votes] });
    return true;
  }

  async finishVote(): Promise<void> {
    if (this.state.phase !== 'VOTE') return;
    if (this.voteTimer) clearTimeout(this.voteTimer);
    this.setPhase('PRODUCE');
    const winningIndex = this.state.votes.reduce((best, count, index, all) => count > (all[best] ?? 0) ? index : best, 0);
    const winner = this.state.shortlist[winningIndex];
    if (winner) this.state.song.push(winner);
    this.state.clip = null;
    this.state.scenes = [];
    const newLines = winner ? [winner] : [];
    const [clip, scenes] = await Promise.all([
      this.options.music.render(this.state.style, this.state.song),
      Promise.all(newLines.map((line) => this.options.artist.create(line, this.state.mood))),
    ]);
    this.state.clip = clip;
    this.state.scenes = scenes;
    scenes.forEach((scene, index) => { const line = newLines[index]; if (line) this.broadcast({ type: 'SCENE', line, scene }); });
    this.broadcast({ type: 'CLIP', clip });
    this.setPhase('PLAY');
    // the clip plays on the overlay; move on once it has finished (plus a short breath)
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = setTimeout(() => void this.finishPlay(), (clip.durationSec + 1.5) * 1000);
  }

  async finishPlay(): Promise<void> {
    if (this.state.phase !== 'PLAY') return;
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
    if (this.state.round >= this.options.roundsPerSong) {
      this.setPhase('RELEASE');
      const clip = await this.options.music.render(this.state.style, this.state.song);
      const id = randomUUID();
      this.state.clip = clip;
      this.options.saveSong?.({ id, channelId: this.options.channelId, title: this.state.title, style: this.state.style, createdAt: this.now(), clip, lines: [...this.state.song] });
      this.broadcast({ type: 'CLIP', clip });
      this.broadcast({ type: 'SAVED', songId: id });
      this.broadcast({ type: 'STATE', state: this.snapshot() });
      void this.options.voice.speak(`That was ${this.state.title}!`);
      // hold the release moment on screen, then go back to IDLE so the next song can start
      if (this.releaseTimer) clearTimeout(this.releaseTimer);
      this.releaseTimer = setTimeout(() => { if (this.state.phase === 'RELEASE') this.setPhase('IDLE'); }, (this.options.releaseSeconds ?? 20) * 1000);
      return;
    }
    await this.beginWrite();
  }

  private clearTimers(): void {
    for (const t of [this.writeTimer, this.voteTimer, this.playTimer, this.releaseTimer]) if (t) clearTimeout(t);
    this.writeTimer = this.voteTimer = this.playTimer = this.releaseTimer = null;
  }

  stop(): void {
    this.clearTimers();
    this.setPhase('IDLE');
  }
}
