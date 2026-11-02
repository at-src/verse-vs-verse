import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { CandidateLine, MusicClip, SceneSpec } from './adapters/types.js';
import { fallbackScene } from './scenes.js';

export type VideoScene = { lineKey: string; scene: SceneSpec; line: CandidateLine; channelName?: string; start: number; end: number; words: MusicClip['words']; interlude?: boolean };
export type SungSegment = {text:string;start:number;end?:number};
export type VideoFrame = { entry: VideoScene; sceneStart: number; cameraStart: number; interlude: boolean };
export const VIDEO_INTRO_SECONDS = 2;
export const VIDEO_CREDITS_SECONDS = 3;
export const VIDEO_EXPORT_TIMEOUT_MS = 10 * 60 * 1000;
let exportTail: Promise<unknown> = Promise.resolve();

export function selectVideoFrame(time: number, scenes: VideoScene[]): VideoFrame | undefined {
  const ordered=[...scenes].sort((a,b)=>a.start-b.start);if(!ordered.length)return undefined;
  const exact=ordered.find((scene)=>time>=scene.start&&time<scene.end);if(exact)return{entry:exact,sceneStart:exact.start,cameraStart:exact.interlude?exact.start:exact.start,interlude:Boolean(exact.interlude)};
  let index=ordered.findIndex((scene)=>time<scene.start);if(index<0)index=ordered.length;
  const previous=ordered[index-1];const next=ordered[index];
  if(previous&&next&&time>=previous.end&&next.start-previous.end>8&&time<next.start)return{entry:previous,sceneStart:previous.start,cameraStart:previous.end,interlude:true};
  const entry=previous??next??ordered[0]!;return{entry,sceneStart:entry.start,cameraStart:entry.start,interlude:false};
}

export function buildVideoTimeline(segments:SungSegment[],chatScenes:VideoScene[],duration:number):VideoScene[]{
  if(!chatScenes.length)return[];const ordered=[...segments].filter(item=>Number.isFinite(item.start)).sort((a,b)=>a.start-b.start);
  const timeline:VideoScene[]=[];let cursor=0;let interludeCount=0;
  const makeInterlude=(start:number,end:number,index:number):VideoScene=>{const source=chatScenes[interludeCount++%chatScenes.length]!;return{...source,lineKey:source.lineKey+'#interlude-'+index,start,end,words:[],interlude:true};};
  const pushChunks=(source:VideoScene,start:number,end:number,interlude:boolean)=>{let at=start,part=0;while(at<end-0.001){const stop=Math.min(end,at+8);timeline.push({...source,start:at,end:stop,interlude:interlude||part>0,words:interlude||part>0?[]:source.words.filter(word=>word.start<stop&&word.end>at)});at=stop;part++;}};
  for(let i=0;i<ordered.length;i++){const segment=ordered[i]!;const start=Math.max(0,Math.min(duration,segment.start));const end=Math.max(start,Math.min(duration,segment.end??ordered[i+1]?.start??duration));if(start>cursor+0.01){let gap=cursor,gapPart=0;while(gap<start-0.01){const stop=Math.min(start,gap+8);timeline.push(makeInterlude(gap,stop,gapPart++));gap=stop;}}
    let best:VideoScene|undefined,bestScore=0;for(const candidate of chatScenes){const score=lyricSimilarity(segment.text,candidate.line.text);if(score>bestScore){best=candidate;bestScore=score;}}
    if(start<end&&best&&bestScore>=0.5){const words=spreadWords(best.line.text,start,end);pushChunks({...best,words},start,end,false);}
    else if(start<end){let at=start,part=0;while(at<end-0.001){const stop=Math.min(end,at+8);timeline.push(makeInterlude(at,stop,part++));at=stop;}}
    cursor=Math.max(cursor,end);
  }
  if(cursor<duration){let at=cursor,part=0;while(at<duration-0.001){const stop=Math.min(duration,at+8);timeline.push(makeInterlude(at,stop,part++));at=stop;}}
  return timeline;
}
function spreadWords(text:string,start:number,end:number):MusicClip['words']{const words=text.trim().split(/\s+/).filter(Boolean);return words.map((word,index)=>({word,start:start+(end-start)*index/Math.max(1,words.length),end:start+(end-start)*(index+0.9)/Math.max(1,words.length)}));}
function lyricSimilarity(a:string,b:string):number{const left=a.toLowerCase().replace(/[^\p{L}\p{N}]/gu,''),right=b.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');if(!left||!right)return 0;const prev=Array.from({length:right.length+1},(_,i)=>i);for(let i=1;i<=left.length;i++){let diag=prev[0]!;prev[0]=i;for(let j=1;j<=right.length;j++){const old=prev[j]!;prev[j]=Math.min(prev[j]!+1,prev[j-1]!+1,diag+(left[i-1]===right[j-1]?0:1));diag=old;}}return 1-prev[right.length]!/Math.max(left.length,right.length);}

export function exportPageHtml(): string {
  return '<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:Chewy;src:url(\'/fonts/Chewy-Regular.ttf\') format(\'truetype\');font-weight:400;font-display:block}html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#2f2a3a}svg{width:1280px;height:720px;display:block}</style></head><body><div id="stage"></div><script type="module" src="/export-page.js"></script></body></html>';
}

export function queueMusicVideoExport(songId: string, title: string, audioPath: string, duration: number, scenes: VideoScene[], onStart?: () => void, onFailure?: (error: unknown) => void, runExport = exportMusicVideo): Promise<string> {
  const task = exportTail.then(() => { onStart?.(); return runExport(songId, title, audioPath, duration, scenes); }).catch((error) => { try { onFailure?.(error); } catch (statusError) { console.error('[Music video] failed to persist export status:', statusError); } throw error; });
  exportTail = task.catch(() => undefined);
  return task;
}

export async function exportMusicVideo(songId: string, title: string, audioPath: string, duration: number, scenes: VideoScene[], chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg', timeoutMs = VIDEO_EXPORT_TIMEOUT_MS, spawnProcess: typeof spawn = spawn): Promise<string> {
  const base = resolve('data/video-work', songId); const media = resolve('data/media');
  let chrome: ReturnType<typeof spawn> | null = null; let ffmpeg: ReturnType<typeof spawn> | null = null; let server: import('node:http').Server | null = null; let client: any = null;
  const kill = (child: ReturnType<typeof spawn> | null) => { if (child && child.exitCode === null) child.kill('SIGKILL'); };
  const work = async (): Promise<string> => {
  const fps = 24; const frameCount = Math.ceil((duration + 5) * fps);
  const httpServer = await import('node:http').then(({ createServer }) => createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/frame') { res.setHeader('content-type','text/html'); res.end(exportPageHtml()); return; }
    if (url.pathname === '/export-page.js') { res.setHeader('content-type','text/javascript'); res.end(await import('node:fs/promises').then(fs => fs.readFile(resolve('public/export-page.js')))); return; }
    if (url.pathname === '/scene-renderer.js') { res.setHeader('content-type','text/javascript'); res.end(await import('node:fs/promises').then(fs => fs.readFile(resolve('public/scene-renderer.js')))); return; }
    if (url.pathname === '/fonts/Chewy-Regular.ttf') { res.setHeader('content-type','font/ttf'); res.end(await import('node:fs/promises').then(fs => fs.readFile(resolve('public/fonts/Chewy-Regular.ttf')))); return; }
    res.writeHead(404).end();
  }));
  server = httpServer;
  await new Promise<void>(resolvePromise=>httpServer.listen(0,'127.0.0.1',resolvePromise));
  const address=httpServer.address(); if(!address||typeof address==='string')throw new Error('Renderer server failed to bind');
  chrome = spawnProcess(chromePath, ['--headless=new','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${resolve(base,'chrome-profile')}`,'about:blank'], { stdio: ['ignore','ignore','pipe'] });
  const stderrText = readProcessText(chrome.stderr!);
  const endpoint = await waitForEndpoint(stderrText, chrome);
  const require = createRequire(import.meta.url);
  const cdp = require('chrome-remote-interface') as (options: { target: string }) => Promise<any>;
  const chromeAddress=new URL(endpoint);
  const listTargets=require('chrome-remote-interface').List as (options:{host:string;port:number})=>Promise<Array<{webSocketDebuggerUrl:string;type:string}>>;
  const targets=await listTargets({host:chromeAddress.hostname,port:Number(chromeAddress.port)});
  const target=targets.find(item=>item.type==='page');if(!target)throw new Error('Chrome created no page target');
  client=await cdp({target:target.webSocketDebuggerUrl});
  const {Page,Runtime,Emulation}=client;
  await Promise.all([Page.enable(),Runtime.enable(),Emulation.setDeviceMetricsOverride({width:1280,height:720,deviceScaleFactor:1,mobile:false})]);
  const pageReady=new Promise<void>(resolvePromise=>Page.loadEventFired(resolvePromise));
  await Page.navigate({url:`http://127.0.0.1:${address.port}/frame`});
  await pageReady;
  const fontCheck=await Runtime.evaluate({expression:'window.fontsReady',awaitPromise:true});
  if(fontCheck.exceptionDetails)throw new Error('Font check failed before video capture: '+(fontCheck.exceptionDetails.exception?.description??fontCheck.exceptionDetails.text??'Chewy failed to load'));
  if(fontCheck.result?.value!==true)throw new Error('Font check failed before video capture: bundled Chewy font is not ready');
  const output=resolve(media,`${songId}.mp4`);
  ffmpeg=spawnProcess(ffmpegPath,['-y','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0','-itsoffset','2','-i',audioPath,'-af','apad=pad_dur=3','-t',String(duration+5),'-vf','scale=1280:720','-c:v','libx264','-pix_fmt','yuv420p','-r',String(fps),'-c:a','aac',output],{stdio:['pipe','ignore','pipe']});
  const ffmpegDone=waitChild(ffmpeg); ffmpegDone.catch(()=>undefined);
    const frameData=(frame:number)=>{const outputTime=frame/fps;if(outputTime<2)return{card:'intro',title,channelName:scenes[0]?.channelName};if(outputTime>=duration+2)return{card:'credits',title,credits:[...new Set(scenes.map(scene=>'@'+scene.line.login))].join(', ')};const time=outputTime-2;const selected=selectVideoFrame(time,scenes);const entry=selected?.entry;return{scene:entry?.scene??emptyScene(title),line:selected?.interlude?'':entry?.line.text??title,words:selected?.interlude?[]:entry?.words??[],time,sceneStart:selected?.sceneStart??0,cameraStart:selected?.cameraStart??0,interlude:selected?.interlude??false};};
    const drawFrame=(frame:number)=>Runtime.evaluate({expression:`window.draw(${JSON.stringify(frameData(frame))})`,awaitPromise:true});
    const queuedFrames:Array<{data:string;sessionId:number}> = [];let nextFrameResolve:((frame:{data:string;sessionId:number})=>void)|null=null;
    Page.screencastFrame((frame:{data:string;sessionId:number})=>{if(nextFrameResolve){const resolveFrame=nextFrameResolve;nextFrameResolve=null;resolveFrame(frame);}else queuedFrames.push(frame);});
    await Page.startScreencast({format:'jpeg',quality:78,maxWidth:1280,maxHeight:720,everyNthFrame:1});
    const nextFrame=()=>new Promise<{data:string;sessionId:number}>(resolvePromise=>{const frame=queuedFrames.shift();if(frame)resolvePromise(frame);else nextFrameResolve=resolvePromise;});
    const initialFrame=await nextFrame();
    await drawFrame(0);
    await Page.screencastFrameAck({sessionId:initialFrame.sessionId});
    let captured=await nextFrame();
    for(let frame=0;frame<frameCount;frame+=1){
      const jpeg=Buffer.from(captured.data,'base64');
      if(ffmpeg.exitCode!==null){await Page.screencastFrameAck({sessionId:captured.sessionId});break;}
      if(!ffmpeg.stdin!.write(jpeg))await new Promise<void>(resolvePromise=>{const done=()=>{ffmpeg!.stdin!.off('drain',done);ffmpeg!.off('exit',done);resolvePromise();};ffmpeg!.stdin!.once('drain',done);ffmpeg!.once('exit',done);});
      if(frame+1<frameCount)await drawFrame(frame+1);
      await Page.screencastFrameAck({sessionId:captured.sessionId});
      if(frame+1<frameCount)captured=await nextFrame();
    }
    await Page.stopScreencast();
    if (ffmpeg.exitCode === null) ffmpeg.stdin!.end(); await ffmpegDone;
  return `/media/${songId}.mp4`;
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await mkdir(base, { recursive: true }); await mkdir(media, { recursive: true });
    return await Promise.race([work(), new Promise<never>((_, reject) => { timeout=setTimeout(()=>reject(new Error(`Video export timed out after ${Math.round(timeoutMs/60000)} minutes`)),timeoutMs); })]);
  } finally {
    if(timeout)clearTimeout(timeout);
    kill(chrome); kill(ffmpeg);
    await Promise.all([waitForExit(chrome),waitForExit(ffmpeg)]);
    try { if(client) await Promise.race([client.close().catch(()=>undefined),new Promise(resolvePromise=>setTimeout(resolvePromise,1000))]); }
    finally {
      try {
        if(server) {
          const currentServer=server as import('node:http').Server;
          currentServer.closeAllConnections?.();
          if(currentServer.listening) await new Promise<void>(resolvePromise=>currentServer.close(()=>resolvePromise()));
        }
      } finally {
        await removeWorkFolder(base);
      }
    }
  }
}

function emptyScene(line:string):SceneSpec{return fallbackScene(line,'day');}
function readProcessText(stream: NodeJS.ReadableStream): Promise<string> { return new Promise((resolvePromise,reject)=>{let text='';stream.setEncoding('utf8');stream.on('data',(chunk:string)=>{text+=chunk;});stream.on('error',reject);const timer=setInterval(()=>{const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearInterval(timer);resolvePromise(match[1]!);}},100);setTimeout(()=>{clearInterval(timer);reject(new Error('Chrome DevTools endpoint timed out'));},10_000).unref();}); }
async function waitForEndpoint(stderr: Promise<string>, chrome: ReturnType<typeof spawn>): Promise<string> { const failed=new Promise<never>((_,reject)=>chrome.once('exit',code=>reject(new Error(`Chrome exited before capture (${code})`))));return Promise.race([stderr,failed]); }
function waitChild(child:ReturnType<typeof spawn>):Promise<void>{return new Promise((resolvePromise,reject)=>{let stderr='';child.stderr?.setEncoding('utf8');child.stderr?.on('data',(chunk:string)=>{stderr+=chunk;});child.stdin?.on('error',()=>undefined);child.once('error',reject);child.once('exit',code=>code===0?resolvePromise():reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`)));});}
function waitForExit(child:ReturnType<typeof spawn>|null):Promise<void>{if(!child||child.exitCode!==null)return Promise.resolve();return Promise.race([new Promise<void>(resolvePromise=>child.once('exit',()=>resolvePromise())),new Promise<void>(resolvePromise=>setTimeout(resolvePromise,1500))]);}
async function removeWorkFolder(path:string):Promise<void>{for(let attempt=0;attempt<5;attempt+=1){try{await rm(path,{recursive:true,force:true});return;}catch(error){if(attempt===4){console.warn('[Music video] work folder cleanup failed:',error);return;}await new Promise(resolvePromise=>setTimeout(resolvePromise,150*(attempt+1)));}}}
