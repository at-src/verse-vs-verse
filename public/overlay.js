import { renderScene } from './scene-renderer.js';

const $=(id)=>document.getElementById(id);
let state;let activeClip=null;let audioStartedFor=null;let animationFrame=0;
const player=$('player');
const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
ws.onmessage=({data})=>{
  const event=JSON.parse(data);
  if(event.type==='STATE'){state=event.state;if(state.phase==='PRODUCE'||(state.phase==='RELEASE'&&!state.clip)){player.pause();activeClip=null;audioStartedFor=null;}render();driveAnimation();}
  if(event.type==='SCENE'){if(state){state.scenes??={};state.scenes[lineKey(event.line)]=event.scene;}render();}
  if(event.type==='VOTE_TALLY'&&state){state.votes=event.counts;render();}
  if(event.type==='CLIP')play(event.clip);
  if(event.type==='VOICE'){const voice=new Audio(event.audioUrl);voice.play().catch(()=>undefined);}
};
fetch('/api/state').then((res)=>res.json()).then((value)=>{state=value;render();driveAnimation();});
// countdowns and the "making the song" timer tick on their own, not only when an event arrives
setInterval(()=>{if(state&&(state.deadline||state.phase==='PRODUCE'||state.phase==='RELEASE'))renderPanel();},500);

function render(){
  if(!state)return;
  renderPanel();
  const preview=$('preview-scene');const lastLine=state.song?.at(-1);const previewScene=lastLine&&getScene(lastLine);
  preview.style.display=['WRITE','VOTE'].includes(state.phase)&&previewScene?'block':'none';
  if(previewScene)renderScene(preview,previewScene,{line:lastLine.text,time:10,bpm:activeClip?.bpm??100});
  $('scene').style.display=['PLAY','RELEASE'].includes(state.phase)?'block':'none';
}

function renderPanel(){
  // while the song plays, shrink the panel to a small tag so it doesn't cover the scene and lyrics
  document.querySelector('.overlay-panel').classList.toggle('compact',state.phase==='PLAY'||(state.phase==='RELEASE'&&Boolean(state.clip)));
  $('phase').textContent=`VERSE vs VERSE · ${state.phase}`;
  $('countdown').textContent=state.deadline?`${Math.max(0,Math.ceil((state.deadline-Date.now())/1000))} seconds`:'';
  const producing=state.phase==='PRODUCE'||(state.phase==='RELEASE'&&!state.clip&&!state.releaseFailed);
  const headlines={IDLE:'The chat writes<br>the next hit.',WRITE:'Drop your line.',SHORTLIST:'The room is listening…',VOTE:'Pick the line.',PRODUCE:state.musicRetrying?'The band is retuning…':'Making a little magic…',PLAY:'Our song so far.',RELEASE:state.musicRetrying?'The band is retuning…':state.clip?state.title:'Mixing the final song…'};
  $('headline').innerHTML=headlines[state.phase];
  if(state.phase==='WRITE')$('content').innerHTML=state.lines.map((line)=>`<div>@${escapeHtml(line.login)} · ${escapeHtml(line.text)}</div>`).join('');
  else if(state.phase==='VOTE')$('content').innerHTML=state.shortlist.map((line,i)=>`<div>!${i+1} · ${escapeHtml(line.text)} <small>(${state.votes[i]||0})</small></div>`).join('');
  else if(state.phase==='RELEASE'&&state.releaseFailed)$('content').textContent='Release failed. Retry is available in the dashboard.';
  else if(state.phase==='RELEASE')$('content').innerHTML=`<div>${state.song.map((line)=>escapeHtml(line.text)).join(' · ')}</div>`;
  else if(producing){
    const seconds=Math.floor((Date.now()-state.phaseStartedAt)/1000);
    const winner=state.phase==='PRODUCE'?(state.song.at(-1)??state.shortlist[state.votes.indexOf(Math.max(...state.votes))]):null;
    $('content').innerHTML=winner?`<div>Winning line by @${escapeHtml(winner.login)}:<br>“${escapeHtml(winner.text)}”</div><div class="mono">the AI band is recording it · ${seconds}s</div>`:`<div>${[...new Set(state.song.map(line=>'@'+line.login))].join(', ')} · ${seconds}s</div>`;
  }
  else if(state.phase==='PLAY'&&!state.clip&&state.clipError)$('content').textContent='This round’s clip could not be rendered. The winning line stays in the song.';
  else $('content').textContent='';
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
    const currentTime=player.currentTime;
    const segments=activeClip.sungSegments?.length?activeClip.sungSegments:activeClip.lineTimings??[];
    let segmentIndex=segments.findIndex((item,index)=>currentTime>=item.start&&currentTime<(item.end??segments[index+1]?.start??activeClip.durationSec));
    let line,scene,words=[],sceneStart=0,cameraStart=0,interlude=false;
    if(segmentIndex>=0){
      const segment=segments[segmentIndex],lineMatch=state.song.map(candidate=>({candidate,score:similarity(segment.text,candidate.text)})).sort((a,b)=>b.score-a.score)[0];
      const end=segment.end??segments[segmentIndex+1]?.start??activeClip.durationSec;
      const shotStart=segment.start+Math.floor(Math.max(0,currentTime-segment.start)/8)*8;
      interlude=!lineMatch||lineMatch.score<.5||shotStart>segment.start+.01;
      line=interlude?undefined:lineMatch?.candidate;
      if(interlude)line=state.song[(segmentIndex+Math.floor((currentTime-segment.start)/8))%Math.max(1,state.song.length)];
      scene=line&&getScene(line);sceneStart=segment.start;cameraStart=interlude?shotStart:segment.start;
      if(!interlude&&line){const lyricWords=line.text.trim().split(/\s+/).filter(Boolean);words=lyricWords.map((word,index)=>({word,start:segment.start+(end-segment.start)*index/lyricWords.length,end:segment.start+(end-segment.start)*(index+0.9)/lyricWords.length}));}
    }else if(state.song.length){
      const shotStart=Math.floor(currentTime/8)*8;line=state.song[Math.floor(currentTime/8)%state.song.length];scene=getScene(line);sceneStart=shotStart;cameraStart=shotStart;interlude=true;
    }
    if(scene)renderScene($('scene'),scene,{line:interlude?'':line?.text??'',words,time:currentTime,sceneStart,cameraStart,interlude,bpm:activeClip.bpm??100});
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
function similarity(a,b){const left=String(a).toLowerCase().replace(/[^\p{L}\p{N}]/gu,''),right=String(b).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');if(!left||!right)return 0;let prev=Array.from({length:right.length+1},(_,i)=>i);for(let i=1;i<=left.length;i++){let diag=prev[0];prev[0]=i;for(let j=1;j<=right.length;j++){const old=prev[j];prev[j]=Math.min(prev[j]+1,prev[j-1]+1,diag+(left[i-1]===right[j-1]?0:1));diag=old;}}return 1-prev[right.length]/Math.max(left.length,right.length);}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
