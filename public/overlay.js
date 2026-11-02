import { renderScene } from './scene-renderer.js';

const $ = (id) => document.getElementById(id);
let state;
let audioStartedFor = null;
let activeScene = null;
let activeLine = '';
let activeClip = null;
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
ws.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  if (event.type === 'STATE') { state = event.state; render(); }
  if (event.type === 'SCENE') { activeScene = event.scene; activeLine = event.line.text; if (activeClip) renderScene($('scene'), activeScene, { line: activeLine, words: wordsForLine(activeClip, activeLine), time: $('player').currentTime }); }
  if (event.type === 'CLIP') play(event.clip);
  if (event.type === 'VOICE') { const voice = new Audio(event.audioUrl); voice.play().catch(() => undefined); }
};
fetch('/api/state').then((res) => res.json()).then((value) => { state = value; render(); });

function render() {
  if (!state) return;
  $('phase').textContent = `VERSE vs VERSE · ${state.phase}`;
  $('countdown').textContent = state.deadline ? `${Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000))} seconds` : '';
  const headline = { IDLE: 'The chat writes<br>the next hit.', WRITE: 'Drop your line.', SHORTLIST: 'The room is listening…', VOTE: 'Pick the line.', PRODUCE: 'Making a little magic…', PLAY: 'Our song so far.', RELEASE: state.title }[state.phase];
  $('headline').innerHTML = headline;
  if (state.phase === 'WRITE') $('content').innerHTML = state.lines.map((line) => `<div>@${escapeHtml(line.login)} · ${escapeHtml(line.text)}</div>`).join('');
  else if (state.phase === 'VOTE') $('content').innerHTML = state.shortlist.map((line, i) => `<div>!${i + 1} · ${escapeHtml(line.text)} <small>(${state.votes[i] || 0})</small></div>`).join('');
  else if (state.phase === 'PLAY') $('content').innerHTML = '';
  else if (state.phase === 'RELEASE') $('content').innerHTML = `<div>${state.song.map((line) => escapeHtml(line.text)).join(' · ')}</div>`;
  else $('content').textContent = '';
  $('preview-scene').style.display = ['WRITE','VOTE'].includes(state.phase) && state.scenes?.length ? 'block' : 'none';
  if (['WRITE','VOTE'].includes(state.phase) && state.scenes?.length) renderScene($('preview-scene'), state.scenes.at(-1), { line: state.scenes.at(-1).line ?? state.song.at(-1)?.text ?? state.scenes.at(-1).keyword });
  $('scene').style.display = state.phase === 'PLAY' ? 'block' : 'none';
}

function renderWords(words) { return words.map((item, i) => `<span class="word" data-start="${item.start}" data-end="${item.end}" data-index="${i}">${escapeHtml(item.word)}</span>`).join(''); }

function play(clip) {
  const player = $('player');
  const key = `${clip.audioUrl}:${clip.durationSec}`;
  if (audioStartedFor === key) return;
  audioStartedFor = key;
  activeClip = clip;
  if (activeScene) renderScene($('scene'), activeScene, { line: activeLine, words: wordsForLine(clip, activeLine), time: 0 });
  player.src = clip.audioUrl;
  player.currentTime = 0;
  player.volume = 1;
  player.play().catch(() => undefined);
  player.ontimeupdate = () => {
    const lastEnd=clip.lineTimings?.at(-1)?.end ?? clip.words.at(-1)?.end ?? clip.durationSec;
    const isRoundClip = state?.phase === 'PLAY';
    const remaining=lastEnd+2-player.currentTime;
    player.volume=isRoundClip&&remaining<2?Math.max(0,Math.min(1,remaining/2)):1;
    if (isRoundClip && player.currentTime >= lastEnd + 2) { player.pause(); return; }
    if (activeScene) updateSceneWords($('scene'), wordsForLine(clip, activeLine), player.currentTime);
  };
}

function wordsForLine(clip, line) {
  const key = String(line).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const timing = clip.lineTimings?.find((item) => String(item.text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === key);
  return timing ? clip.words.filter((word) => word.start >= timing.start && word.start < timing.end) : clip.words;
}

function updateSceneWords(container, words, time) {
  container.querySelectorAll('.lyric-word').forEach((node) => {
    const item = words[Number(node.dataset.wordIndex)];
    node.classList.toggle('active', Boolean(item && time >= item.start && time <= item.end));
  });
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
