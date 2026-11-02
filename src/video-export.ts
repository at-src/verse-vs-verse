import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { CandidateLine, MusicClip, SceneSpec } from './adapters/types.js';
import { fallbackScene } from './scenes.js';

export type VideoScene = { lineKey: string; scene: SceneSpec; line: CandidateLine; start: number; end: number; words: MusicClip['words'] };
export type VideoFrame = { entry: VideoScene; sceneStart: number; cameraStart: number; interlude: boolean };
export const VIDEO_INTRO_SECONDS = 2;
export const VIDEO_CREDITS_SECONDS = 3;
export const VIDEO_EXPORT_TIMEOUT_MS = 10 * 60 * 1000;
let exportTail: Promise<unknown> = Promise.resolve();

export function selectVideoFrame(time: number, scenes: VideoScene[]): VideoFrame | undefined {
  const ordered=[...scenes].sort((a,b)=>a.start-b.start);if(!ordered.length)return undefined;
  let index=ordered.findIndex((scene)=>time<scene.start);if(index<0)index=ordered.length;
  const previous=ordered[index-1];const next=ordered[index];
  if(previous&&next&&time>=previous.end&&next.start-previous.end>8&&time<next.start)return{entry:previous,sceneStart:previous.start,cameraStart:previous.end,interlude:true};
  const entry=previous??next??ordered[0]!;return{entry,sceneStart:entry.start,cameraStart:entry.start,interlude:false};
}

export function exportPageHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:Chewy;src:url('/fonts/Chewy-Regular.ttf') format('truetype');font-weight:400;font-display:block}html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#f3ecdf}svg{width:1280px;height:720px;display:block}</style></head><body><div id="stage"></div><script type="module">import{renderSceneSvg}from'/scene-renderer.js';window.fontsReady=(async()=>{const loaded=await document.fonts.load('54px Chewy');await document.fonts.ready;if(!loaded.length||!document.fonts.check('54px Chewy'))throw new Error('Bundled Chewy font failed to load');return true})();window.draw=async(data)=>{document.getElementById('stage').innerHTML=renderSceneSvg(data.scene,{line:data.line,words:data.words,time:data.time,sceneStart:data.sceneStart,cameraStart:data.cameraStart,quality:'export',interlude:data.interlude});await new Promise(requestAnimationFrame);return true};</script></body></html>`;
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
  const fps = 24; const frameCount = Math.ceil(duration * fps);
  const httpServer = await import('node:http').then(({ createServer }) => createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/frame') { res.setHeader('content-type','text/html'); res.end(exportPageHtml()); return; }
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
  await Runtime.evaluate({expression:'window.fontsReady',awaitPromise:true});
  const output=resolve(media,`${songId}.mp4`);
  ffmpeg=spawnProcess(ffmpegPath,['-y','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0','-i',audioPath,'-t',String(duration),'-vf','scale=1280:720','-c:v','libx264','-pix_fmt','yuv420p','-r',String(fps),'-c:a','aac','-shortest',output],{stdio:['pipe','ignore','pipe']});
  const ffmpegDone=waitChild(ffmpeg); ffmpegDone.catch(()=>undefined);
    const frameData=(frame:number)=>{const time=frame/fps;const selected=selectVideoFrame(time,scenes);const entry=selected?.entry;return{scene:entry?.scene??emptyScene(title),line:selected?.interlude?'':entry?.line.text??title,words:selected?.interlude?[]:entry?.words??[],time,sceneStart:selected?.sceneStart??0,cameraStart:selected?.cameraStart??0,interlude:selected?.interlude??false};};
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
