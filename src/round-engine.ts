import { randomUUID } from 'node:crypto';
import type { CandidateLine, LineJudge, Moderation, MusicProvider, SceneArtist, SceneSpec, Voice, MusicClip } from './adapters/types.js';
import { sceneKeyForLine, type SceneIndex } from './scene-index.js';
import { fallbackScene } from './scenes.js';
export type { CandidateLine } from './adapters/types.js';

export type Phase = 'IDLE' | 'WRITE' | 'SHORTLIST' | 'VOTE' | 'PRODUCE' | 'PLAY' | 'RELEASE';
export type RoundEvent =
  | { type: 'STATE'; state: RoundState }
  | { type: 'MUSIC_FAILED'; release: boolean; message: string }
  | { type: 'CHAT_LINE'; line: CandidateLine }
  | { type: 'VOTE_TALLY'; counts: number[] }
  | { type: 'SCENE'; line: CandidateLine; scene: SceneSpec }
  | { type: 'CLIP'; clip: MusicClip }
  | { type: 'SAVED'; songId: string }
  | { type: 'VOICE'; audioUrl: string };
export type RoundState = {
  phase: Phase; round: number; roundsPerSong: number; writeSeconds: number; voteSeconds: number; loopMode: boolean; loopWaiting: boolean; style: string; mood: string;
  deadline: number | null; phaseStartedAt: number; clipStartedAt: number | null; lines: CandidateLine[]; shortlist: CandidateLine[]; votes: number[];
  song: CandidateLine[]; clip: MusicClip | null; scenes: SceneIndex; title: string; musicRetrying: boolean; clipError: string | null; releaseFailed: boolean;
};
type EngineOptions = {
  writeSeconds: number; voteSeconds: number; roundsPerSong: number; maxSongsPerHour: number; releaseSeconds?: number;
  channelId: string; channelLogin: string; judge: LineJudge; moderation: Moderation;
  music: MusicProvider; artist: SceneArtist; voice: Voice;
  now?: () => number; broadcast?: (event: RoundEvent) => void;
  onLoopLimit?: () => void;
  onReleaseFailure?: (song:{id:string;channelId:string;title:string;style:string;createdAt:number;lines:CandidateLine[];error:string})=>void;
  saveSong?: (song: { id: string; channelId: string; title: string; style: string; createdAt: number; clip: MusicClip; lines: CandidateLine[]; scenes: SceneIndex }) => void;
  saveScene?: (line: string, scene: SceneSpec) => void;
  onRelease?: (song: { id: string; title: string; style: string; mood: string; clip: MusicClip; lines: CandidateLine[]; scenes: SceneIndex }) => void | Promise<void>;
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
  private autoLoopTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSettings: {writeSeconds:number;voteSeconds:number;roundsPerSong:number};
  private releaseSongId: string | null = null;
  private roundUsers = new Set<string>();
  private roundVoters = new Set<string>();
  private state: RoundState = {
    phase: 'IDLE', round: 0, roundsPerSong: 4, writeSeconds:45,voteSeconds:30,loopMode:true,loopWaiting:false,style: 'pop', mood: 'playful', deadline: null, phaseStartedAt: 0, clipStartedAt: null,
    lines: [], shortlist: [], votes: [], song: [], clip: null, scenes: {}, title: 'Verse vs Verse',
    musicRetrying:false,clipError:null,releaseFailed:false,
  };
  private phaseStartedAt = 0;

  constructor(private readonly options: EngineOptions) {
    this.now = options.now ?? Date.now;
    this.broadcast = options.broadcast ?? (() => undefined);
    this.state.roundsPerSong = options.roundsPerSong;
    this.state.writeSeconds=options.writeSeconds;this.state.voteSeconds=options.voteSeconds;this.pendingSettings={writeSeconds:options.writeSeconds,voteSeconds:options.voteSeconds,roundsPerSong:options.roundsPerSong};
  }

  snapshot(): RoundState { return structuredClone(this.state); }
  settings(){return{...this.pendingSettings,loopMode:this.state.loopMode};}
  updateSettings(settings:Partial<{writeSeconds:number;voteSeconds:number;roundsPerSong:number;loopMode:boolean}>):RoundState{
    for(const key of ['writeSeconds','voteSeconds','roundsPerSong'] as const){const value=settings[key];if(value!==undefined&&Number.isInteger(value)&&value>0)this.pendingSettings[key]=value;}
    if(settings.loopMode!==undefined){this.state.loopMode=settings.loopMode;if(!settings.loopMode){if(this.autoLoopTimer)clearTimeout(this.autoLoopTimer);this.autoLoopTimer=null;this.state.loopWaiting=false;}}
    this.broadcast({type:'STATE',state:this.snapshot()});return this.snapshot();
  }

  private setPhase(phase: Phase, seconds?: number): void {
    this.state.phase = phase;
    this.phaseStartedAt = this.now();
    this.state.phaseStartedAt = this.phaseStartedAt;
    this.state.deadline = seconds ? this.now() + seconds * 1000 : null;
    this.broadcast({ type: 'STATE', state: this.snapshot() });
  }

  async start(style = 'pop', mood = 'playful'): Promise<void> {
    if (this.state.phase !== 'IDLE' && this.state.phase !== 'RELEASE') throw new Error('A song is already in progress');
    if(this.autoLoopTimer)clearTimeout(this.autoLoopTimer);this.autoLoopTimer=null;
    this.clearTimers();
    const hourAgo = this.now() - 60 * 60 * 1000;
    while (this.songTimes.length && this.songTimes[0]! < hourAgo) this.songTimes.shift();
    if (this.songTimes.length >= this.options.maxSongsPerHour) throw new Error('Hourly song limit reached');
    this.songTimes.push(this.now());
    this.usersThisHour.clear();
    this.state = { ...this.state, phase: 'IDLE', round: 0, ...this.pendingSettings, style, mood, lines: [], shortlist: [], votes: [], song: [], clip: null, scenes: {}, title: 'Verse vs Verse', deadline: null, clipStartedAt: null, loopWaiting:false,musicRetrying:false,clipError:null,releaseFailed:false };
    await this.beginWrite();
  }

  private async beginWrite(): Promise<void> {
    this.state.round += 1;
    this.roundUsers = new Set();
    this.roundVoters = new Set();
    this.state.lines = [];
    this.state.shortlist = [];
    this.state.votes = [];
    this.setPhase('WRITE', this.state.writeSeconds);
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => void this.finishWrite(), this.state.writeSeconds * 1000);
  }

  async submitLine(line: CandidateLine): Promise<boolean> {
    if (this.state.phase !== 'WRITE' || this.roundUsers.has(line.userId)) return false;
    const text = line.text.trim().replace(/\s+/g, ' ');
    if (!text || text.length > 80 || LINK_OR_EMOTE.test(text) || /\b(\w+)(?:\s+\1){3,}/i.test(text)) return false;
    if (await this.options.moderation.check(text) !== 'ok') return false;
    const accepted = { ...line, id: line.id ?? randomUUID(), text };
    this.roundUsers.add(line.userId);
    this.state.lines.push(accepted);
    this.broadcast({ type: 'CHAT_LINE', line: accepted });
    this.broadcast({ type: 'STATE', state: this.snapshot() });
    return true;
  }

  async moderate(text: string): Promise<'ok' | 'blocked'> { return this.options.moderation.check(text); }

  async finishWrite(): Promise<void> {
    if (this.state.phase !== 'WRITE') return;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.setPhase('SHORTLIST');
    let shortlist: CandidateLine[];
    try { shortlist = await this.options.judge.choose(this.state.lines, this.state.song, this.state.style, this.state.mood); }
    catch (error) { console.warn('[LineJudge] falling back to mock:', error); shortlist = this.state.lines.slice(0, 4); }
    const candidates = new Map(this.state.lines.map((line) => [line.text, line]));
    const ranked = shortlist.filter((line, index, all) => candidates.has(line.text) && all.findIndex((item) => item.text === line.text) === index);
    // the judge ranks; it must not leave chat with a one-option vote, so top up with the other moderated lines
    this.state.shortlist = [...ranked, ...this.state.lines.filter((line) => !ranked.some((item) => item.text === line.text))].slice(0, 4);
    if (!this.state.shortlist.length) {
      console.info('[Round] no viewer lines were accepted; skipping this verse without inventing lyrics');
      if(this.state.round>=this.state.roundsPerSong){this.setPhase('IDLE');if(this.state.loopMode)this.startLoopNext();}else await this.beginWrite();
      return;
    }
    this.state.votes = this.state.shortlist.map(() => 0);
    this.setPhase('VOTE', this.state.voteSeconds);
    if (this.voteTimer) clearTimeout(this.voteTimer);
    this.voteTimer = setTimeout(() => void this.finishVote(), this.state.voteSeconds * 1000);
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
    this.state.clip = null;this.state.clipError=null;this.state.musicRetrying=false;
    const newLines = winner ? [winner] : [];
    const scenePromise=Promise.all(newLines.map(async(line)=>{try{return await this.options.artist.create(line,this.state.song,this.state.mood);}catch(error){console.error('[SceneArtist] scene failed:',error);return fallbackScene(line.text,this.state.mood);}}));
    let clip:MusicClip|null=null;
    try {
      clip=await this.renderMusic(false,false);
      if(clip.fidelityScore!==undefined&&clip.fidelityScore<0.6){
        console.warn('[Music fidelity] round score below 0.6; regenerating once with strict lyrics');
        clip=await this.renderMusic(false,true);
      }
      this.state.clip=clip;this.state.clipStartedAt=this.now();
    } catch(error) {
      this.state.clipError=error instanceof Error?error.message:String(error);
      this.state.musicRetrying=false;
    }
    const scenes=await scenePromise;
    scenes.forEach((scene,index)=>{const lyric=newLines[index];if(lyric)scene.line=lyric.text;});
    scenes.forEach((scene,index)=>{const line=newLines[index];if(line){this.state.scenes[sceneKeyForLine(line)]=scene;this.options.saveScene?.(line.text,scene);this.broadcast({type:'SCENE',line,scene});}});
    this.state.musicRetrying=false;
    if(clip)this.broadcast({type:'CLIP',clip});
    this.setPhase('PLAY');
    if(!clip)this.broadcast({type:'MUSIC_FAILED',release:false,message:'The band could not render this round. Keeping the winning line and moving on.'});
    if(this.playTimer)clearTimeout(this.playTimer);
    const lastLineEnd=clip?.lineTimings?.at(-1)?.end??clip?.words.at(-1)?.end??(clip?.durationSec??1);
    this.playTimer=setTimeout(()=>void this.finishPlay(),(clip?Math.max(0,lastLineEnd)+2:1.5)*1000);
  }

  private renderMusic(release:boolean,strict:boolean):Promise<MusicClip>{
    return this.options.music.render(this.state.style,[...this.state.song],this.state.mood,release,strict,()=>{
      this.state.musicRetrying=true;this.broadcast({type:'STATE',state:this.snapshot()});
    });
  }

  async finishPlay(): Promise<void> {
    if(this.state.phase!=='PLAY')return;
    if(this.playTimer)clearTimeout(this.playTimer);this.playTimer=null;
    if(this.state.round>=this.state.roundsPerSong){await this.produceRelease(false);return;}
    await this.beginWrite();
  }

  async retryRelease():Promise<boolean>{
    if(this.state.phase!=='RELEASE'||!this.state.releaseFailed)return false;
    await this.produceRelease(true);return true;
  }

  private async produceRelease(retry:boolean):Promise<void>{
    if(!retry){this.setPhase('RELEASE');this.releaseSongId=randomUUID();this.state.clip=null;this.state.clipError=null;}
    this.state.releaseFailed=false;this.state.musicRetrying=false;
    if(this.releaseTimer)clearTimeout(this.releaseTimer);
    try{
      const clip=await this.renderMusic(true,false);
      if(clip.isMock)throw new Error('Release audio is a mock; configure Pascal and retry before saving this song.');
      if(this.options.judge.title){try{this.state.title=await this.options.judge.title(this.state.song,this.state.style,this.state.mood);}catch(error){console.warn('[Title] falling back to default:',error);}}
      this.state.clip=clip;this.state.clipStartedAt=this.now();
      const id=this.releaseSongId??randomUUID();this.releaseSongId=id;
      this.options.saveSong?.({id,channelId:this.options.channelId,title:this.state.title,style:this.state.style,createdAt:this.now(),clip,lines:[...this.state.song],scenes:{...this.state.scenes}});
      this.broadcast({type:'CLIP',clip});this.broadcast({type:'SAVED',songId:id});this.broadcast({type:'STATE',state:this.snapshot()});
      const holdMs=(this.options.releaseSeconds??20)*1000;this.state.deadline=this.now()+holdMs;this.broadcast({type:'STATE',state:this.snapshot()});
      this.releaseTimer=setTimeout(()=>{if(this.state.phase!=='RELEASE')return;this.setPhase('IDLE');if(this.state.loopMode)this.startLoopNext();},holdMs);
      void Promise.resolve(this.options.voice.speak('That was '+this.state.title+'!')).then((voiceUrl)=>{if(voiceUrl)this.broadcast({type:'VOICE',audioUrl:voiceUrl});}).catch((error)=>console.warn('[Voice] release announcement failed:',error));
      void Promise.resolve(this.options.onRelease?.({id,title:this.state.title,style:this.state.style,mood:this.state.mood,clip,lines:[...this.state.song],scenes:{...this.state.scenes}})).catch((error)=>console.error('[Release] background work failed:',error));
    }catch(error){
      this.state.clip=null;this.state.musicRetrying=false;this.state.releaseFailed=true;this.state.clipError=error instanceof Error?error.message:String(error);
      this.options.onReleaseFailure?.({id:this.releaseSongId??randomUUID(),channelId:this.options.channelId,title:this.state.title,style:this.state.style,createdAt:this.now(),lines:[...this.state.song],error:this.state.clipError});
      this.broadcast({type:'STATE',state:this.snapshot()});
      this.broadcast({type:'MUSIC_FAILED',release:true,message:'Release render failed; retry is available in the dashboard.'});
    }
  }

  private startLoopNext():void{
    if(!this.state.loopMode)return;
    try{void this.start(this.state.style,this.state.mood).catch(error=>this.waitForSongLimit(error));}
    catch(error){this.waitForSongLimit(error);}
  }

  private waitForSongLimit(error:unknown):void{
    if(!(error instanceof Error)||!error.message.includes('Hourly song limit reached')){console.error('[Loop] could not start next song:',error);return;}
    if(!this.state.loopWaiting){this.state.loopWaiting=true;this.broadcast({type:'STATE',state:this.snapshot()});this.options.onLoopLimit?.();}
    if(this.autoLoopTimer)clearTimeout(this.autoLoopTimer);
    const next=this.songTimes[0]??this.now();
    this.autoLoopTimer=setTimeout(()=>{this.autoLoopTimer=null;if(!this.state.loopMode)return;this.state.loopWaiting=false;this.startLoopNext();},Math.max(1000,next+60*60*1000-this.now()+1000));
  }

  skipPlay(): boolean {
    if (this.state.phase !== 'PLAY') return false;
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
    if (this.state.round >= this.state.roundsPerSong) this.playTimer = setTimeout(() => void this.finishPlay(), 100);
    else void this.finishPlay();
    return true;
  }

  private clearTimers(): void {
    for (const t of [this.writeTimer, this.voteTimer, this.playTimer, this.releaseTimer, this.autoLoopTimer]) if (t) clearTimeout(t);
    this.writeTimer = this.voteTimer = this.playTimer = this.releaseTimer = this.autoLoopTimer = null;
  }

  stop(): void {
    this.clearTimers();
    this.state.loopWaiting=false;
    this.setPhase('IDLE');
  }
}
