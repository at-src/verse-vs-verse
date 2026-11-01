const $ = (id) => document.getElementById(id);
let state = null;
let ws;

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = (message) => { const event = JSON.parse(message.data); if (event.type === 'STATE') state = event.state; render(); if (event.type === 'SAVED') loadHistory(); };
  ws.onclose = () => setTimeout(connect, 1200);
}

function render() {
  if (!state) return;
  $('phase').textContent = state.phase;
  $('round').textContent = `ROUND ${state.round} / ${state.roundsPerSong}`;
  $('prompt-title').textContent = state.phase === 'VOTE' ? 'Vote for the next line' : state.phase === 'PLAY' ? 'Now playing' : 'Live room';
  $('prompt').textContent = state.phase === 'WRITE' ? 'Send !line <your lyric>. One line per viewer this round.' : state.phase === 'VOTE' ? 'Vote with !1, !2, !3 or !4.' : `Style: ${state.style} · Mood: ${state.mood}`;
  $('timer').textContent = state.deadline ? `${Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000))}s` : '—';
  const duration = state.phase === 'WRITE' ? Number(document.documentElement.dataset.writeSeconds || 45) : Number(document.documentElement.dataset.voteSeconds || 30);
  $('progress').style.width = state.deadline ? `${Math.max(0, Math.min(100, (1 - (state.deadline - Date.now()) / (duration * 1000)) * 100))}%` : '0%';
  $('lines').innerHTML = (state.phase === 'VOTE' ? state.shortlist.map((line, i) => `<div class="line"><strong>!${i + 1} · @${escapeHtml(line.login)}</strong><span>${escapeHtml(line.text)}</span><span class="muted">${state.votes[i] || 0}</span></div>`) : state.lines.map((line) => `<div class="line"><strong>@${escapeHtml(line.login)}</strong><span>${escapeHtml(line.text)}</span></div>`)).join('');
  $('song-lines').innerHTML = state.song.length ? state.song.map((line, i) => `<div class="line"><strong>${String(i + 1).padStart(2, '0')} @${escapeHtml(line.login)}</strong><span>${escapeHtml(line.text)}</span></div>`).join('') : '<span class="muted">No lines yet.</span>';
}

async function loadState() { state = await (await fetch('/api/state')).json(); render(); }
async function loadHistory() {
  const songs = await (await fetch('/api/songs')).json();
  $('history').innerHTML = songs.length ? songs.map((song) => `<div class="history-item"><span><b>${escapeHtml(song.title)}</b><br><small class="muted">${new Date(song.createdAt).toLocaleString()} · ${escapeHtml(song.style)}</small></span><button class="secondary" data-id="${song.id}">Replay</button></div>`).join('') : '<span class="muted">No released songs yet.</span>';
  $('history').querySelectorAll('button').forEach((button) => button.addEventListener('click', async () => {
    const song = songs.find((item) => item.id === button.dataset.id);
    if (song) { const audio = new Audio(song.audioUrl); await audio.play(); }
  }));
}

$('start').addEventListener('click', async () => { const response = await fetch('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style: $('style').value, mood: $('mood').value }) }); const result = await response.json(); if (!response.ok) $('sim-result').textContent = result.error; else { state = result; render(); } });
$('stop').addEventListener('click', async () => { state = await (await fetch('/api/stop', { method: 'POST' })).json(); render(); });
$('eventsub').addEventListener('click', async () => {
  const result = await (await fetch('/api/twitch/connect', { method: 'POST' })).json();
  $('sim-result').textContent = result.error ?? 'EventSub listener connected.';
});
$('sim').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await (await fetch('/api/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: $('login').value, text: $('message').value }) })).json();
  state = result.state; render(); $('sim-result').textContent = result.accepted ? 'Message accepted.' : 'Message ignored for this phase or already used.';
  $('message').value = '';
});

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
setInterval(() => { if (state) render(); }, 250);
async function loadTwitchStatus() {
  const result = await (await fetch('/api/twitch/status')).json();
  $('connection').textContent = result.connected ? `TWITCH · @${result.account}` : 'MOCK MODE · LOCAL SIMULATION';
}
fetch('/api/config').then((res) => res.json()).then((value) => { document.documentElement.dataset.writeSeconds = String(value.writeSeconds); document.documentElement.dataset.voteSeconds = String(value.voteSeconds); });
connect(); void loadState(); void loadHistory(); void loadTwitchStatus();
