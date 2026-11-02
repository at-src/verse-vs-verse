import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { CandidateLine, MusicClip, SceneSpec } from './adapters/types.js';

export type VideoScene = { scene: SceneSpec; line: CandidateLine; words: MusicClip['words'] };
export const VIDEO_EXPORT_TIMEOUT_MS = 10 * 60 * 1000;
let exportTail: Promise<unknown> = Promise.resolve();

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
    if (url.pathname === '/frame') { res.setHeader('content-type','text/html'); res.end(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#f3ecdf}svg{width:1280px;height:720px}</style></head><body><div id="stage"></div><script type="module">import{renderSceneSvg}from'/scene-renderer.js';window.draw=(data)=>{document.getElementById('stage').innerHTML=renderSceneSvg(data.scene,{line:data.line,words:data.words,time:data.time,animate:false})};</script></body></html>`); return; }
    if (url.pathname === '/scene-renderer.js') { res.setHeader('content-type','text/javascript'); res.end(await import('node:fs/promises').then(fs => fs.readFile(resolve('public/scene-renderer.js')))); return; }
    res.writeHead(404).end();
  }));
  server = httpServer;
  await new Promise<void>(resolvePromise=>httpServer.listen(0,'127.0.0.1',resolvePromise));
  const address=httpServer.address(); if(!address||typeof address==='string')throw new Error('Renderer server failed to bind');
  chrome = spawnProcess(chromePath, ['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${resolve(base,'chrome-profile')}`,'about:blank'], { stdio: ['ignore','ignore','pipe'] });
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
  await Page.navigate({url:`http://127.0.0.1:${address.port}/frame`});
  await new Promise(resolvePromise=>setTimeout(resolvePromise,500));
  const output=resolve(media,`${songId}.mp4`);
  ffmpeg=spawnProcess(ffmpegPath,['-y','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0','-i',audioPath,'-t',String(duration),'-vf','scale=1280:720','-c:v','libx264','-pix_fmt','yuv420p','-r',String(fps),'-c:a','aac','-shortest',output],{stdio:['pipe','ignore','pipe']});
  const ffmpegDone=waitChild(ffmpeg); ffmpegDone.catch(()=>undefined); // awaited below; never an unhandled rejection
    // The picture only changes when the scene changes or another word appears (frames are drawn with
    // animate:false), so render on those changes only and repeat the last JPEG in between. The clay filter
    // makes each render expensive: this turns ~2,800 renders for a 2-minute song into ~60.
    let lastKey = ''; let lastJpeg: Buffer | null = null;
    for (let frame=0;frame<frameCount;frame+=1) {
      const time=frame/fps; const index=[...scenes.keys()].reverse().find((i)=>time >= (scenes[i]!.words[0]?.start ?? 0)) ?? 0;
      const entry=scenes[index];
      const scene=entry?.scene??emptyScene(title); const line=entry?.line.text??title;
      const words=entry?.words??[];
      const key=`${index}:${words.filter((word)=>word.start<=time).length}`;
      if (key !== lastKey || !lastJpeg) {
        await Runtime.evaluate({expression:`window.draw(${JSON.stringify({scene,line,words,time})})`,awaitPromise:true});
        const screenshot=await Page.captureScreenshot({format:'jpeg',quality:82,fromSurface:true});
        lastJpeg=Buffer.from(screenshot.data,'base64'); lastKey=key;
      }
      if (ffmpeg.exitCode !== null) break; // ffmpeg stopped early: stop feeding it, its error is reported below
      // wait for room in the pipe, but give up if ffmpeg exits meanwhile (otherwise this waits forever)
      if (!ffmpeg.stdin!.write(lastJpeg)) await new Promise<void>(resolvePromise=>{ const done=()=>{ ffmpeg!.stdin!.off('drain',done); ffmpeg!.off('exit',done); resolvePromise(); }; ffmpeg!.stdin!.once('drain',done); ffmpeg!.once('exit',done); });
    }
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
    try { if(client) await Promise.race([client.close().catch(()=>undefined),new Promise(resolvePromise=>setTimeout(resolvePromise,1000))]); }
    finally {
      try {
        if(server) {
          const currentServer=server as import('node:http').Server;
          currentServer.closeAllConnections?.();
          if(currentServer.listening) await new Promise<void>(resolvePromise=>currentServer.close(()=>resolvePromise()));
        }
      } finally {
        await rm(base,{recursive:true,force:true}).catch(error=>console.warn('[Music video] work folder cleanup failed:',error));
      }
    }
  }
}

function emptyScene(keyword:string):SceneSpec{return{keyword,mood:'day',ground:true,mascot:{pose:'stand',x:580,y:370,scale:1,facing:'left'},props:[]};}
function readProcessText(stream: NodeJS.ReadableStream): Promise<string> { return new Promise((resolvePromise,reject)=>{let text='';stream.setEncoding('utf8');stream.on('data',(chunk:string)=>{text+=chunk;});stream.on('error',reject);const timer=setInterval(()=>{const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearInterval(timer);resolvePromise(match[1]!);}},100);setTimeout(()=>{clearInterval(timer);reject(new Error('Chrome DevTools endpoint timed out'));},10_000).unref();}); }
async function waitForEndpoint(stderr: Promise<string>, chrome: ReturnType<typeof spawn>): Promise<string> { const failed=new Promise<never>((_,reject)=>chrome.once('exit',code=>reject(new Error(`Chrome exited before capture (${code})`))));return Promise.race([stderr,failed]); }
function run(command:string,args:string[]):Promise<void>{return new Promise((resolvePromise,reject)=>{const child=spawn(command,args,{stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolvePromise():reject(new Error(`${command} exited ${code}`)));});}
function waitChild(child:ReturnType<typeof spawn>):Promise<void>{return new Promise((resolvePromise,reject)=>{let stderr='';child.stderr?.setEncoding('utf8');child.stderr?.on('data',(chunk:string)=>{stderr+=chunk;});child.stdin?.on('error',()=>undefined);child.once('error',reject);child.once('exit',code=>code===0?resolvePromise():reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`)));});}
