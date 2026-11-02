import { mkdir, writeFile } from 'node:fs/promises';
import { exportMusicVideo } from './src/video-export.js';
const wav=Buffer.alloc(44+22050*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
await mkdir('data/media',{recursive:true});await writeFile('data/media/smoke.wav',wav);
const line={text:'wishing on every one that you be mine',userId:'1',login:'lena'};
const scene={keyword:'wishing',mood:'dream',ground:true,mascot:{pose:'blow',x:370,y:352,scale:1,facing:'right'},props:[]};
console.log(await exportMusicVideo('smoke-export','Wishing Smoke','data/media/smoke.wav',1,[{scene,line,words:line.text.split(' ').map((word,index)=>({word,start:index*.12,end:index*.12+.1}))}]));
