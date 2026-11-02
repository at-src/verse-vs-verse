const PALETTE={cream:'#fffaf0',paper:'#f3ecdf',sand:'#d9cfc0',brown:'#8a5a3c',terra:'#c96f4a',rose:'#f08a8a',mustard:'#e3b448',yellow:'#ffd23f',leaf:'#7cbf6a',grass:'#5ea85a',stem:'#4f9a62',teal:'#7fd1c7',deep:'#3f8f87',blue:'#3f6fc0',night:'#2f2a3a',ink:'#2a2622',shade:'#e8b41f'};
const MOODS={day:'#f3ecdf',dream:'#efe6f2',night:'#2f2a3a',warm:'#f6e3c8',sea:'#e3f1ef'};
const POSES=new Set(['stand','sit','walk','blow','lookup','puzzled','sleep','wave','hug','jump']);
const ENTER=new Set(['drop','grow','slide','drift','draw','pop']);

export function renderSceneSvg(scene,{line=scene.line??scene.keyword,words=[],time=0,sceneStart=0,cameraStart=sceneStart,quality='overlay',interlude=false}={}){
  const safe=normalizeScene(scene);const local=Math.max(0,time-sceneStart);const dark=safe.mood==='night';const ink=dark?'#fff4d6':'#2f6f7a';
  const stars=dark?Array.from({length:14},(_,i)=>`<circle cx="${40+(i*137)%720}" cy="${24+(i*47)%135}" r="${i%3+2}" fill="${PALETTE.yellow}"/>`).join(''):'';
  const octaves=quality==='export'?1:2;
  const filter=quality==='export'?'<filter id="clay" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="1" seed="7" result="n"/><feComponentTransfer in="n" result="texture"><feFuncR type="linear" slope=".12" intercept=".44"/><feFuncG type="linear" slope=".12" intercept=".44"/><feFuncB type="linear" slope=".12" intercept=".44"/></feComponentTransfer><feBlend in="SourceGraphic" in2="texture" mode="soft-light"/></filter>':`<filter id="clay" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="${octaves}" seed="7" result="n"/><feDiffuseLighting in="n" lighting-color="#fff" surfaceScale="1.4" result="l"><feDistantLight azimuth="225" elevation="58"/></feDiffuseLighting><feComposite in="l" in2="SourceGraphic" operator="in" result="t"/><feBlend in="SourceGraphic" in2="t" mode="multiply" result="b"/><feDropShadow dx="4" dy="7" stdDeviation="5" flood-color="#5a4a3a" flood-opacity=".3"/></filter>`;
  const layerFilter=quality==='export'?'':' filter="url(#clay)"';
  // Keep palette surfaces flat and exact; clay lighting belongs on foreground objects.
  const backdrop=`<rect width="800" height="450" fill="${MOODS[safe.mood]}"/>${stars}`;
  const ground=safe.ground?`<path d="M0 354 Q190 317 360 360 T800 344 V450 H0Z" fill="#7cbf6a"/>`:'';
  const props=safe.props.map((prop,i)=>renderProp(prop,i,local,quality)).join('');
  const mascot=mascotSvg(interlude?{...safe.mascot,pose:'lookup'}:safe.mascot,safe.mood,local,quality);
  const labels=renderLine(line,words,time,ink,safe.keyword);
  const title=interlude?'':`<g${layerFilter}><text x="400" y="196" text-anchor="middle" fill="${ink}" font-family="Chewy" font-size="54" font-weight="400" class="keyword">${escapeXml(safe.keyword.toUpperCase())}</text></g>`;
  const foreground=`${props}${mascot}${title}<g${layerFilter}>${labels}</g>`;
  const cameraTime=Math.max(0,time-cameraStart);const drift=interlude?Math.sin(cameraTime*.42)*8:0;const scale=interlude?1.018:1;
  const content=`${backdrop}${ground}${foreground}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" role="img"><defs>${filter}<clipPath id="scene-canvas"><rect width="800" height="450"/></clipPath></defs><g transform="translate(${drift.toFixed(2)} 0) translate(400 225) scale(${scale}) translate(-400 -225)" clip-path="url(#scene-canvas)">${content}</g></svg>`;
}

function renderProp(prop,index,time,quality){
  const delay=index*.12;const seconds=Math.max(0,time-delay);const durations={drop:.9,grow:.7,slide:.75,drift:1.15,draw:1,pop:.65};const progress=clamp(seconds/durations[prop.enter],0,1);const eased=progress<1?1-Math.pow(1-progress,3):1;
  let transform='';let opacity=1;
  if(prop.enter==='drop'){const bounce=progress<1?1-eased:0;transform=`translate(0 ${(-500*(1-eased)+Math.sin(progress*Math.PI*2)*12*bounce).toFixed(2)}) scale(1 ${(1+.15*(1-eased)).toFixed(3)})`;}
  else if(prop.enter==='grow')transform=`translate(400 350) scale(${(.05+.95*eased).toFixed(3)}) translate(-400 -350)`;
  else if(prop.enter==='slide')transform=`translate(${(900*(1-eased)).toFixed(2)} 0)`;
  else if(prop.enter==='drift'){transform=`translate(0 ${(30*(1-eased)).toFixed(2)})`;opacity=eased;}
  else if(prop.enter==='pop'){const overshoot=progress<.72?.1*Math.sin(progress/.72*Math.PI):0;transform=`translate(400 320) scale(${(.08+.92*eased+overshoot).toFixed(3)}) translate(-400 -320)`;}
  const clip=prop.enter==='draw'?`<defs><clipPath id="draw-${index}"><rect x="0" y="0" width="${(800*eased).toFixed(2)}" height="450"/></clipPath></defs>`:'';
  const filter=quality==='export'?'':' filter="url(#clay)"';
  return `<g transform="translate(0 -25)"><g${filter}>${clip}<g transform="${transform}" opacity="${opacity.toFixed(3)}"${prop.enter==='draw'?` clip-path="url(#draw-${index})"`:''}>${prop.svg}</g></g></g>`;
}

function renderLine(line,words,time,ink,keyword){
  const wordsInLine=String(line??'').trim().split(/\s+/).filter(Boolean);if(!wordsInLine.length)return'';
  const key=String(keyword).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const clean=(word)=>word.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const isKey=(word)=>clean(word)===key;
  const fontSize=(word)=>isKey(word)?37.4:22;
  const wordWidth=(word)=>Math.max(fontSize(word)*.52*word.length,12);
  const rows=[];let row=[];let width=0;
  for(let index=0;index<wordsInLine.length;index++){
    const word=wordsInLine[index],next=wordWidth(word)+(row.length?10:0);
    if(width+next>560&&row.length&&rows.length<1){rows.push(row);row=[];width=0;}
    row.push({word,index});width+=next;
  }
  if(row.length)rows.push(row);
  if(rows.length>2){const items=rows.flat(),mid=Math.ceil(items.length/2);rows.splice(0,rows.length,items.slice(0,mid),items.slice(mid));}
  const layout=rows.map((items,rowIndex)=>{
    const total=items.reduce((sum,item)=>sum+wordWidth(item.word),0)+Math.max(0,items.length-1)*10;
    let x=(800-total)/2;
    return items.map(item=>{const w=wordWidth(item.word),cx=x+w/2;x+=w+10;return{...item,x:cx,y:(rows.length===1?405:390+rowIndex*26)};});
  }).flat();
  let minX=Infinity,maxX=-Infinity;
  for(const item of layout){const half=wordWidth(item.word)/2;minX=Math.min(minX,item.x-half);maxX=Math.max(maxX,item.x+half);}
  const pill='<rect x="'+Math.max(80,minX-24)+'" y="376" width="'+Math.min(640,maxX-minX+48)+'" height="52" rx="24" fill="#2a2622" fill-opacity=".82" stroke="#c96f4a" stroke-opacity=".72" stroke-width="3"/>';
  const texts=layout.map(item=>{
    const timing=words[item.index],active=Boolean(timing&&time>=timing.start&&time<=timing.end);
    let opacity=1,scale=active?1.06:1;
    const label=isKey(item.word)?item.word.toUpperCase():item.word.toLowerCase();
    return '<text class="lyric-word'+(active?' active':'')+'" data-word-index="'+item.index+'" x="'+item.x.toFixed(2)+'" y="'+item.y+'" text-anchor="middle" fill="'+(isKey(item.word)||active?'#c96f4a':'#fffaf0')+'" font-family="Chewy" font-size="'+fontSize(item.word)+'" font-weight="400" stroke="#2a2622" stroke-width="1.5" paint-order="stroke fill" opacity="'+opacity.toFixed(3)+'" transform="translate('+item.x.toFixed(2)+' '+item.y+') scale('+scale.toFixed(3)+') translate(-'+item.x.toFixed(2)+' -'+item.y+')">'+escapeXml(label)+'</text>';
  }).join('');
  return '<g class="lyric-block">'+pill+texts+'</g>';
}
export function renderScene(container,scene,options={}){container.innerHTML=renderSceneSvg(scene,options);return container.querySelector('svg');}

function mascotSvg(spec,mood,time,quality){
  const pose=POSES.has(spec.pose)?spec.pose:'stand';const scale=clamp(spec.scale,.4,1.5);const x=clamp(spec.x,43*scale+5,795-43*scale);const y=clamp(spec.y,25+100*scale,300);const mirror=spec.facing==='left'?-1:1;
  const config={stand:{bodyY:0,tilt:0,arm:'down',legs:'stand'},sit:{bodyY:14,tilt:0,arm:'rest',legs:'sit'},walk:{bodyY:0,tilt:-5,arm:'swing',legs:'walk'},blow:{bodyY:0,tilt:4,arm:'blow',legs:'stand'},lookup:{bodyY:0,tilt:-4,arm:'up',legs:'stand'},puzzled:{bodyY:0,tilt:5,arm:'puzzle',legs:'stand'},sleep:{bodyY:8,tilt:-8,arm:'rest',legs:'sit'},wave:{bodyY:0,tilt:0,arm:'wave',legs:'stand'},hug:{bodyY:0,tilt:2,arm:'hug',legs:'stand'},jump:{bodyY:-20,tilt:0,arm:'up',legs:'jump'}}[pose];
  const bob=Math.sin(time*2.4)*2;const blinkPhase=(time+.37)%5;const blink=blinkPhase>4.68&&blinkPhase<4.82?.08:1;
  const eyes=pose==='sleep'?`<path d="M-17 -58 q7 7 14 0 M8 -58 q7 7 14 0" stroke="${PALETTE.ink}" stroke-width="4" fill="none" stroke-linecap="round"/>`:`<g transform="translate(0 -59) scale(1 ${blink}) translate(0 59)"><circle cx="-13" cy="-59" r="5" fill="${PALETTE.ink}"/><circle cx="-14" cy="-61" r="1.7" fill="${PALETTE.cream}"/><circle cx="13" cy="-59" r="5" fill="${PALETTE.ink}"/><circle cx="12" cy="-61" r="1.7" fill="${PALETTE.cream}"/></g>`;
  const arms={down:'<path d="M-30 -35 Q-48 -22 -50 -5 M30 -35 Q48 -22 50 -5"',rest:'<path d="M-30 -35 Q-42 -8 -22 0 M30 -35 Q42 -8 22 0"',swing:`<path d="M-30 -35 Q-55 ${-45+Math.sin(time*8)*12} -58 -30 M30 -35 Q55 ${-15-Math.sin(time*8)*12} 58 -25"`,blow:'<path d="M-30 -35 Q-45 -12 -50 -8 M30 -35 Q50 -48 53 -45"',up:'<path d="M-30 -35 Q-52 -55 -48 -74 M30 -35 Q52 -55 48 -74"',puzzle:'<path d="M-30 -35 Q-48 -20 -45 -8 M30 -35 Q48 -65 55 -54"',wave:'<path d="M-30 -35 Q-45 -15 -50 -8 M30 -35 Q52 -57 58 -79"',hug:'<path d="M-30 -35 Q-4 -4 0 -22 M30 -35 Q4 -4 0 -22"'}[config.arm];
  const step=config.legs==='walk'?Math.sin(time*8)*3:0;
  const clayLegs='<g fill="none" stroke="#ffd23f" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M-14 9 L-17 '+(27+step).toFixed(1)+' Q-22 '+(31+step).toFixed(1)+' -28 '+(31+step).toFixed(1)+' M14 9 L17 '+(27-step).toFixed(1)+' Q22 '+(31-step).toFixed(1)+' 28 '+(31-step).toFixed(1)+'"/></g>';
  const walk=Math.sin(time*8)*8;const legs=config.legs==='sit'?'<path d="M-20 12 Q-38 20 -45 18 M20 12 Q38 20 45 18"/>':config.legs==='walk'?`<path d="M-14 12 L${(-24-walk).toFixed(1)} 27 M14 12 L${(24+walk).toFixed(1)} 27"/>`:config.legs==='jump'?'<path d="M-14 10 L-34 22 M14 10 L34 22"/>':'<path d="M-14 12 L-18 27 M14 12 L18 27"/>';
  const filter=quality==='export'?'':' filter="url(#clay)"';
  return `<g transform="translate(0 -25)"><g${filter}><g transform="translate(${x} ${y+bob+config.bodyY})"><g transform="scale(${mirror*scale} ${scale})"><g transform="rotate(${config.tilt})"><g fill="none" stroke="${PALETTE.ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${clayLegs}${arms}/>${legs}</g><g class="mascot-body"><path d="M-43 -20 Q-49 -76 -22 -88 Q0 -98 23 -87 Q49 -75 43 -20 Q38 9 0 14 Q-38 9 -43 -20Z" fill="${PALETTE.yellow}" stroke="${PALETTE.mustard}" stroke-width="5"/><path d="M5 -86 Q42 -78 43 -20 Q38 8 0 14 Q18 -10 5 -86Z" fill="${PALETTE.shade}" opacity=".6"/>${eyes}<ellipse cx="-27" cy="-43" rx="7" ry="4" fill="${PALETTE.rose}"/><ellipse cx="27" cy="-43" rx="7" ry="4" fill="${PALETTE.rose}"/><path d="M-5 -38 Q0 -33 5 -38" fill="none" stroke="${PALETTE.ink}" stroke-width="3" stroke-linecap="round"/></g></g></g></g></g></g>`;
}

function normalizeScene(scene){return{keyword:String(scene.keyword??'VERSE'),mood:MOODS[scene.mood]?scene.mood:'day',ground:Boolean(scene.ground),mascot:scene.mascot??{pose:'stand',x:600,y:370,scale:1,facing:'left'},props:Array.isArray(scene.props)?scene.props.filter(prop=>prop&&typeof prop.svg==='string'&&ENTER.has(prop.enter)):[]};}
function escapeXml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
