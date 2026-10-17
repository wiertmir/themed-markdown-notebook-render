// Runs in the notebook webview, next to VS Code's markdown-it renderer.
// That renderer copies every <template class="markdown-style"> from <head> into each markdown cell's shadow root.
const style = document.createElement('style');
style.className = 'themed-markdown';
const template = document.createElement('template');
template.classList.add('markdown-style');
template.content.appendChild(style);
document.head.appendChild(template);

// Fences in these languages become a placeholder holding their source; a viewer (loaded on first use) draws into it
// once the cell is in the DOM. Mermaid diagrams are drawn again when VS Code switches between light and dark.
const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const mermaidTheme = () => ['vscode-light', 'vscode-high-contrast-light'].some(c => document.body.classList.contains(c)) ? 'default' : 'dark';
let mermaid, theme, n = 0;

async function drawMermaid(target, src) {
  mermaid ??= (await import('./vendor/mermaid/mermaid.esm.min.mjs')).default;
  if (theme !== mermaidTheme()) mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true, theme: theme = mermaidTheme() });
  target.innerHTML = (await mermaid.render(`${target.id}-svg`, src)).svg;
}

// GeoJSON / TopoJSON on OpenStreetMap tiles, like GitHub shows them.
async function drawMap(target, src, lang) {
  const L = await import('./vendor/leaflet/leaflet-src.esm.js');
  let data = JSON.parse(src);
  if (lang === 'topojson') {
    const { feature } = await import('./vendor/topojson-client/index.js');
    const features = Object.values(data.objects).map(o => feature(data, o)).flatMap(f => f.features ?? [f]);
    data = { type: 'FeatureCollection', features };
  }
  // the cell is a shadow root, so Leaflet's CSS has to go inside it
  const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./vendor/leaflet/leaflet.css', import.meta.url) });
  target.replaceChildren(css);
  await new Promise(r => { css.onload = css.onerror = r; });
  target.style.height = '320px';
  const map = L.map(target);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  const layer = L.geoJSON(data, {
    pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 6 }),  // marker icons can't find their images from a shadow root
    onEachFeature: (f, l) => f.properties && Object.keys(f.properties).length &&
      l.bindPopup(Object.entries(f.properties).map(([k, v]) => `<b>${escapeHtml(k)}</b>: ${escapeHtml(String(v))}`).join('<br>')),
  }).addTo(map);
  map.fitBounds(layer.getBounds(), { maxZoom: 16 });
}

// ASCII STL (a fence can't hold binary), shaded, drag to rotate, scroll to zoom.
async function drawStl(target, src) {
  const [THREE, { STLLoader }, { OrbitControls }] = await Promise.all(['three.module.js', 'STLLoader.js', 'OrbitControls.js']
    .map(f => import(`./vendor/three/${f}`)));
  const geometry = new STLLoader().parse(src).center();
  geometry.computeBoundingSphere();
  const r = geometry.boundingSphere.radius || 1, width = target.clientWidth || 600, height = 320;
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color: 0x9aa4b0, flatShading: true })));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
  const camera = new THREE.PerspectiveCamera(45, width / height, r / 100, r * 100);
  camera.position.set(r * 1.6, r * 1.2, r * 2);
  camera.add(new THREE.DirectionalLight(0xffffff, 1.5));  // light follows the view
  scene.add(camera);
  // ponytail: one WebGL context per model, browsers drop the oldest past ~16; share one renderer if notebooks get that many
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(width, height);
  target.replaceChildren(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.addEventListener('change', () => renderer.render(scene, camera));
  renderer.render(scene, camera);
}

const VIEWERS = { mermaid: drawMermaid, geojson: drawMap, topojson: drawMap, stl: drawStl };
const DRAGGABLE = new Set(['geojson', 'topojson', 'stl']);  // their own drag pans or rotates

// cells live in shadow roots, so look there
const placeholders = () => [...document.querySelectorAll('*')]
  .flatMap(el => el.shadowRoot ? [...el.shadowRoot.querySelectorAll('div.themed-viewer')] : []);

async function draw(target) {
  // a mousedown in a cell lets the notebook drag the whole cell; Leaflet and OrbitControls still get their events
  if (DRAGGABLE.has(target.dataset.lang)) target.onmousedown = e => e.preventDefault();
  try {
    await VIEWERS[target.dataset.lang](target, target.dataset.src, target.dataset.lang);
  } catch (e) {
    target.style.height = '';
    target.innerHTML = `<pre style="white-space: pre-wrap; color: var(--vscode-errorForeground, #f14c4c)">${escapeHtml(String(e?.message ?? e))}</pre>`;
  }
}

// VS Code toggles vscode-light / vscode-dark on <body> when the theme changes
new MutationObserver(async () => {
  if (!mermaid || theme === mermaidTheme()) return;
  for (const el of placeholders()) if (el.dataset.lang === 'mermaid') await draw(el);
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

export async function activate(ctx) {
  const markdownIt = await ctx.getRenderer('vscode.markdown-it-renderer');
  markdownIt?.extendMarkdownIt(md => {
    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, ...rest) => {
      const token = tokens[idx];
      const lang = token.info.trim().split(/\s+/)[0].toLowerCase();
      if (!Object.hasOwn(VIEWERS, lang)) return fence(tokens, idx, ...rest);
      const id = `themed-viewer-${n++}`;
      setTimeout(() => { const target = placeholders().find(el => el.id === id); if (target) draw(target); });
      return `<div class="themed-viewer" id="${id}" data-lang="${lang}" data-src="${md.utils.escapeHtml(token.content)}"></div>`;
    };
  });

  ctx.onDidReceiveMessage?.(css => {
    style.textContent = css;
    // cells rendered before keep their own copy of the style
    for (const el of document.querySelectorAll('*'))
      el.shadowRoot?.querySelectorAll('style.themed-markdown').forEach(s => { s.textContent = css; });
  });
  ctx.postMessage?.('ready');  // ask the extension for the current theme's CSS
}
