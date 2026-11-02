import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { CandidateLine, MusicClip, SceneSpec } from './adapters/types.js';

export type VideoScene = { scene: SceneSpec; line: CandidateLine; words: MusicClip['words'] };

export async function exportMusicVideo(songId: string, title: string, audioPath: string, duration: number, scenes: VideoScene[], chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg'): Promise<string> {
  const base = resolve('data/video-work', songId); const frames = resolve(base, 'frames'); const media = resolve('data/media');
  await mkdir(frames, { recursive: true }); await mkdir(media, { recursive: true });
  const fps = 30; const frameCount = Math.ceil(duration * fps);
  const server = await import('node:http').then(({ createServer }) => createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/frame') { res.setHeader('content-type','text/html'); res.end(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#f3ecdf}svg{width:1280px;height:720px}</style></head><body><div id="stage"></div><script type="module">import{renderSceneSvg}from'/scene-renderer.js';window.draw=(data)=>{document.getElementById('stage').innerHTML=renderSceneSvg(data.scene,{line:data.line,words:data.words,time:data.time,animate:false})};</script></body></html>`); return; }
    if (url.pathname === '/scene-renderer.js') { res.setHeader('content-type','text/javascript'); res.end(await import('node:fs/promises').then(fs => fs.readFile(resolve('public/scene-renderer.js')))); return; }
    res.writeHead(404).end();
  }));
  await new Promise<void>(resolvePromise=>server.listen(0,'127.0.0.1',resolvePromise));
  const address=server.address(); if(!address||typeof address==='string')throw new Error('Renderer server failed to bind');
  const chrome = spawn(chromePath, ['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${resolve(base,'chrome-profile')}`,'about:blank'], { stdio: ['ignore','ignore','pipe'] });
  const stderrText = readProcessText(chrome.stderr!);
  const endpoint = await waitForEndpoint(stderrText, chrome);
  const require = createRequire(import.meta.url);
  const cdp = require('chrome-remote-interface') as (options: { target: string }) => Promise<any>;
  const chromeAddress=new URL(endpoint);
  const listTargets=require('chrome-remote-interface').List as (options:{host:string;port:number})=>Promise<Array<{webSocketDebuggerUrl:string;type:string}>>;
  const targets=await listTargets({host:chromeAddress.hostname,port:Number(chromeAddress.port)});
  const target=targets.find(item=>item.type==='page');if(!target)throw new Error('Chrome created no page target');
  const client=await cdp({target:target.webSocketDebuggerUrl});
  const {Page,Runtime,Emulation}=client;
  await Promise.all([Page.enable(),Runtime.enable(),Emulation.setDeviceMetricsOverride({width:1280,height:720,deviceScaleFactor:1,mobile:false})]);
  await Page.navigate({url:`http://127.0.0.1:${address.port}/frame`});
  await new Promise(resolvePromise=>setTimeout(resolvePromise,500));
  try {
    for (let frame=0;frame<frameCount;frame+=1) {
      const time=frame/fps; const entry=[...scenes].reverse().find((item)=>time >= (item.words[0]?.start ?? 0))??scenes[0];
      const scene=entry?.scene??emptyScene(title); const line=entry?.line.text??title;
      const words=entry?.words??[];
      await Runtime.evaluate({expression:`window.draw(${JSON.stringify({scene,line,words,time})})`,awaitPromise:true});
      const screenshot=await Page.captureScreenshot({format:'png',fromSurface:true});
      await writeFile(resolve(frames,`${String(frame).padStart(6,'0')}.png`),Buffer.from(screenshot.data,'base64'));
    }
  } finally { await client.close(); chrome.kill(); await new Promise<void>(resolvePromise=>server.close(()=>resolvePromise())); }
  const output=resolve(media,`${songId}.mp4`); const inputPattern=resolve(frames,'%06d.png');
  await run(ffmpegPath,['-y','-framerate',String(fps),'-i',inputPattern,'-i',audioPath,'-t',String(duration),'-vf','scale=1280:720','-c:v','libx264','-pix_fmt','yuv420p','-r',String(fps),'-c:a','aac','-shortest',output]);
  await rm(base,{recursive:true,force:true});
  return `/media/${songId}.mp4`;
}

function emptyScene(keyword:string):SceneSpec{return{keyword,mood:'day',ground:true,mascot:{pose:'stand',x:580,y:370,scale:1,facing:'left'},props:[]};}
function readProcessText(stream: NodeJS.ReadableStream): Promise<string> { return new Promise((resolvePromise,reject)=>{let text='';stream.setEncoding('utf8');stream.on('data',(chunk:string)=>{text+=chunk;});stream.on('error',reject);const timer=setInterval(()=>{const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearInterval(timer);resolvePromise(match[1]!);}},100);setTimeout(()=>{clearInterval(timer);reject(new Error('Chrome DevTools endpoint timed out'));},10_000).unref();}); }
async function waitForEndpoint(stderr: Promise<string>, chrome: ReturnType<typeof spawn>): Promise<string> { const failed=new Promise<never>((_,reject)=>chrome.once('exit',code=>reject(new Error(`Chrome exited before capture (${code})`))));return Promise.race([stderr,failed]); }
function run(command:string,args:string[]):Promise<void>{return new Promise((resolvePromise,reject)=>{const child=spawn(command,args,{stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolvePromise():reject(new Error(`${command} exited ${code}`)));});}
