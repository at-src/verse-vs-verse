import { renderScene, renderSceneSvg } from './scene-renderer.js';
const $=(id)=>document.getElementById(id);
async function gallery(){const scenes=await(await fetch('/api/scenes')).json();$('gallery').innerHTML='';for(const scene of scenes){const card=document.createElement('article');card.className='gallery-card';const stage=document.createElement('div');stage.className='preview-canvas';renderScene(stage,scene,{time:10});const caption=document.createElement('small');caption.textContent=scene.keyword;card.append(stage,caption);$('gallery').append(card);}}
$('preview-form').addEventListener('submit',async event=>{event.preventDefault();$('message').textContent='Making a scene…';const response=await fetch('/api/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line:$('line').value,mood:$('mood').value})});const data=await response.json();if(!response.ok){$('message').textContent=data.error;return;}$('message').textContent='Scene ready.';renderScene($('preview'),data.scene,{line:$('line').value,time:10});void gallery();});
void gallery();

const sampleLines=[
  'my cat stole the controller tonight',
  'chai at midnight with the city lights',
  'we were dancing in the rain',
  'pizza is cold but the vibes are warm',
  'my rocket ride to the moon',
  'the dog ate my homework again',
  'fire in the chat tonight',
  'a ghost joined the stream',
  'crown me king of the lobby',
  'my guitar is out of tune',
];
const moments=[.15,.45,.9];
function wordsFor(line,duration=4){const words=line.split(/\s+/);return words.map((word,index)=>({word,start:duration*index/words.length,end:duration*(index+.9)/words.length}));}
function moodFor(line){const value=line.toLowerCase();if(/midnight|moon|ghost|tonight/.test(value))return'night';if(/rain|chai/.test(value))return'warm';return'day';}
function renderSamples(){const gallery=$('sample-gallery');gallery.innerHTML='';for(const line of sampleLines){const row=document.createElement('div');row.className='sample-row';const caption=document.createElement('div');caption.innerHTML=`<div class="sample-line">${line}</div><div class="sample-label">named prop inferred from lyric</div>`;row.append(caption);for(const time of moments){const frame=document.createElement('div');frame.className='sample-frame';frame.innerHTML=renderSceneSvg({line,keyword:line.split(/\s+/).find(word=>!['my','the','a','we','in','at','with','is','but','were','me','of'].includes(word.toLowerCase()))||line.split(' ')[0],mood:moodFor(line),ground:true,mascot:{pose:'stand',x:625,y:320,scale:1,facing:'left'},props:[]},{line,words:wordsFor(line),time,sceneStart:0,cameraStart:0,bpm:100});row.append(frame);}gallery.append(row);}}
$('render-samples').addEventListener('click',renderSamples);
if(new URLSearchParams(location.search).has('samples')){document.body.classList.add('samples');renderSamples();}
