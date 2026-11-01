export function renderScene(container, scene) {
  container.innerHTML = '';
  const layer = document.createElement('div');
  layer.className = `scene scene-${scene.backdrop}`;
  layer.innerHTML = `<div class="scene-sky"></div><div class="scene-floor"></div><div class="scene-mascot" aria-label="${escapeHtml(scene.keyword)}">●</div><div class="scene-prop">${scene.propsSvg}</div><div class="scene-caption">${escapeHtml(scene.keyword)}</div>`;
  container.append(layer);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
