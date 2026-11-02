import { renderSceneSvg, renderTransitionSvg } from '/scene-renderer.js';

const stage = document.getElementById('stage');
const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

window.fontsReady = (async () => {
  await document.fonts.load('40px Chewy');
  await document.fonts.ready;
  if (!document.fonts.check('40px Chewy')) {
    throw new Error('Music video export stopped: bundled Chewy font is unavailable (document.fonts.check failed).');
  }
  return true;
})();

window.draw = async data => {
  if (data.card === 'intro') {
    stage.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#2f2a3a"/><ellipse cx="400" cy="430" rx="300" ry="70" fill="#3f8f87"/><circle cx="105" cy="90" r="7" fill="#ffd23f"/><circle cx="690" cy="112" r="6" fill="#ffd23f"/><circle cx="620" cy="75" r="4" fill="#ffd23f"/><text x="400" y="190" text-anchor="middle" fill="#ffd23f" stroke="#2a2622" stroke-width="4" paint-order="stroke fill" font-family="Chewy" font-size="54">' + escapeXml(data.title) + '</text><text x="400" y="255" text-anchor="middle" fill="#fffaf0" font-family="Chewy" font-size="29">written live by Twitch chat</text>' + (data.channelName ? '<text x="400" y="305" text-anchor="middle" fill="#f08a8a" font-family="Chewy" font-size="24">' + escapeXml(data.channelName) + '</text>' : '') + '</svg>';
  } else if (data.card === 'credits') {
    stage.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#2f2a3a"/><text x="400" y="175" text-anchor="middle" fill="#ffd23f" font-family="Chewy" font-size="48">' + escapeXml(data.title) + '</text><text x="400" y="245" text-anchor="middle" fill="#fffaf0" font-family="Chewy" font-size="30">lyrics by</text><text x="400" y="295" text-anchor="middle" fill="#f08a8a" font-family="Chewy" font-size="25">' + escapeXml(data.credits) + '</text></svg>';
  } else {
    stage.innerHTML = data.prev ? renderTransitionSvg({ scene: data.scene, options: { line: data.line, words: data.words, time: data.time, sceneStart: data.sceneStart, cameraStart: data.cameraStart, quality: 'export', interlude: data.interlude } }, { scene: data.prev.scene, options: { line: data.prev.line, words: data.prev.words, time: data.prev.time, sceneStart: data.prev.sceneStart, cameraStart: data.prev.cameraStart, quality: 'export', interlude: data.prev.interlude } }, data.progress) : renderSceneSvg(data.scene, { line: data.line, words: data.words, time: data.time, sceneStart: data.sceneStart, cameraStart: data.cameraStart, quality: 'export', interlude: data.interlude });
  }
  await new Promise(requestAnimationFrame);
  return true;
};
