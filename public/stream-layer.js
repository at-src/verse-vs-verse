// Stream layout (overlay.html?stream=1): the channel's room behind the overlay and an on-camera streamer
// that reacts to the game. Used by the built-in broadcaster; OBS users keep the transparent overlay.
import { renderStreamerSvg } from './scene-renderer.js';

const POSES = {
  IDLE: { pose: 'wave', expression: 'happy', facing: 'right' },
  WRITE: { pose: 'point', expression: 'happy', facing: 'left' },
  SHORTLIST: { pose: 'puzzled', expression: 'neutral', facing: 'left' },
  VOTE: { pose: 'cheer', expression: 'happy', facing: 'right' },
  PRODUCE: { pose: 'lookup', expression: 'surprised', facing: 'right' },
  RELEASE: { pose: 'dance', expression: 'happy', facing: 'right' },
};

export function startStreamLayer(getState, subscribe) {
  const room = document.createElement('div');
  room.className = 'stream-room';
  const glow = document.createElement('div');
  glow.className = 'stream-glow';
  const streamer = document.createElement('div');
  streamer.className = 'stream-streamer';
  const shell = document.querySelector('.overlay-shell');
  shell.prepend(streamer); shell.prepend(glow); shell.prepend(room);
  document.body.classList.add('stream-mode');

  let phase = null, phaseAt = performance.now(), nodAt = -1e9;
  subscribe((event) => {
    if (event.type === 'CHAT_LINE' || event.type === 'VOTE_TALLY') nodAt = performance.now();
  });
  const tick = (now) => {
    const state = getState();
    const current = state?.phase ?? 'IDLE';
    if (current !== phase) { phase = current; phaseAt = now; }
    const sceneShowing = current === 'PLAY' || (current === 'RELEASE' && state?.clip);
    streamer.style.opacity = sceneShowing ? '0' : '1';
    const t = now / 1000, since = (now - phaseAt) / 1000;
    // a winner was just picked: celebrate for two seconds, then listen while the band records
    const look = current === 'PRODUCE' && since < 2 ? { pose: 'jump', expression: 'happy', facing: 'right' } : POSES[current] ?? POSES.IDLE;
    const nod = Math.max(0, 1 - (now - nodAt) / 450);
    if (!sceneShowing) streamer.innerHTML = renderStreamerSvg({ ...look, time: t, poseTime: since + 1, hop: Math.sin(nod * Math.PI) * 14 });
    glow.style.opacity = (0.35 + 0.25 * Math.max(0, Math.sin(t * Math.PI * 2 * (100 / 60)))).toFixed(3);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
