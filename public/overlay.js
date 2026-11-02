import { renderScene } from './scene-renderer.js';

const $=(id)=>document.getElementById(id);
let state;let activeClip=null;let audioStartedFor=null;let animationFrame=0;
const player=$('player');
const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
ws.onmessage=({data})=>{
  const event=JSON.parse(data);
  if(event.type==='STATE'){state=event.state;render();driveAnimation();}
  if(event.type==='SCENE'){if(state){state.scenes??={};state.scenes[lineKey(event.line)]=event.scene;}render();}
  if(event.type==='CLIP')play(event.clip);
  if(event.type==='VOICE'){const voice=new Audio(event.audioUrl);voice.play().catch(()=>undefined);}
};
fetch('/api/state').then((res)=>res.json()).then((value)=>{state=value;render();driveAnimation();});

function render(){
  if(!state)return;
  $('phase').textContent=`VERSE vs VERSE · ${state.phase}`;
  $('countdown').textContent=state.deadline?`${Math.max(0,Math.ceil((state.deadline-Date.now())/1000))} seconds`:'';
  const headlines={IDLE:'The chat writes<br>the next hit.',WRITE:'Drop your line.',SHORTLIST:'The room is listening…',VOTE:'Pick the line.',PRODUCE:'Making a little magic…',PLAY:'Our song so far.',RELEASE:state.title};
  $('headline').innerHTML=headlines[state.phase];
  if(state.phase==='WRITE')$('content').innerHTML=state.lines.map((line)=>`<div>@${escapeHtml(line.login)} · ${escapeHtml(line.text)}</div>`).join('');
  else if(state.phase==='VOTE')$('content').innerHTML=state.shortlist.map((line,i)=>`<div>!${i+1} · ${escapeHtml(line.text)} <small>(${state.votes[i]||0})</small></div>`).join('');
  else if(state.phase==='RELEASE')$('content').innerHTML=`<div>${state.song.map((line)=>escapeHtml(line.text)).join(' · ')}</div>`;
  else $('content').textContent='';
  const preview=$('preview-scene');const lastLine=state.song?.at(-1);const previewScene=lastLine&&getScene(lastLine);
  preview.style.display=['WRITE','VOTE'].includes(state.phase)&&previewScene?'block':'none';
  if(previewScene)renderScene(preview,previewScene,{line:lastLine.text,time:10});
  $('scene').style.display=['PLAY','RELEASE'].includes(state.phase)?'block':'none';
}

function play(clip){
  const key=`${clip.audioUrl}:${clip.durationSec}`;if(audioStartedFor===key)return;
  audioStartedFor=key;activeClip=clip;player.src=clip.audioUrl;player.currentTime=0;player.volume=1;
  player.play().catch(()=>undefined);
  player.ontimeupdate=()=>{
    const lastEnd=clip.lineTimings?.at(-1)?.end??clip.words.at(-1)?.end??clip.durationSec;
    if(state?.phase==='PLAY'){
      const remaining=lastEnd+2-player.currentTime;player.volume=remaining<2?Math.max(0,Math.min(1,remaining/2)):1;
      if(player.currentTime>=lastEnd+2)player.pause();
    }else player.volume=1;
  };
  driveAnimation();
}

function driveAnimation(){
  cancelAnimationFrame(animationFrame);
  const tick=()=>{
    if(!state||!activeClip||!['PLAY','RELEASE'].includes(state.phase))return;
    const currentTime=player.currentTime;const timings=activeClip.lineTimings??[];
    let timing;let line;
    for(const item of timings){if(item.start<=currentTime){const found=state.song.find((candidate)=>sameLine(candidate.text,item.text));if(found){timing=item;line=found;}}}
    line??=state.song.at(-1);timing??=timings.find((item)=>line&&sameLine(item.text,line.text));
    const scene=line&&getScene(line);
    if(scene&&line){const words=timing?activeClip.words.filter((word)=>word.start>=timing.start&&word.start<timing.end):activeClip.words;renderScene($('scene'),scene,{line:line.text,words,time:currentTime,sceneStart:timing?.start??0});}
    if(state.phase==='PLAY'){
      const lastEnd=activeClip.lineTimings?.at(-1)?.end??activeClip.words.at(-1)?.end??activeClip.durationSec;
      if(currentTime>=lastEnd+2){player.pause();return;}
    }
    animationFrame=requestAnimationFrame(tick);
  };
  if(['PLAY','RELEASE'].includes(state?.phase))animationFrame=requestAnimationFrame(tick);
}

function getScene(line){return state?.scenes?.[lineKey(line)];}
function lineKey(line){return line.id??JSON.stringify([line.userId,line.text]);}
function sameLine(a,b){return String(a).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')===String(b).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
