(() => {
'use strict';
const $ = id => document.getElementById(id);
const cv = $('map'), ctx = cv.getContext('2d'), stage = $('stage');
const DEF = { xmin: -3499, xmax: 3499, zmin: -3499, zmax: 3499 };
const S = { img: null, W: 0, H: 0, z: 1, ox: 0, oy: 0, fit: 1, fh: false, fv: false,
  sel: null, me: null, explore: false, zone: null, markers: [], grid: false, gstep: 500, cfg: { ...DEF }, dpr: 1 };
const KEY = 'mcmapper.v1';
const EDIT = new URLSearchParams(location.search).has('editor');
if (!EDIT) document.body.classList.add('public');

/* Píxel original (px,py) -> pantalla: u = flip ? W-c : c ; pantalla = offset + zoom*u (c = px+0.5)
 * Píxel -> Minecraft: lineal con índices 0..W-1 / 0..H-1; no depende de zoom ni inversión. */
const toMC = (px, py) => {
  const c = S.cfg;
  return [Math.round(c.xmin + (S.W > 1 ? px / (S.W - 1) : 0) * (c.xmax - c.xmin)),
          Math.round(c.zmin + (S.H > 1 ? py / (S.H - 1) : 0) * (c.zmax - c.zmin))];
};
const mcToPx = (X, Z) => [S.W > 1 ? (X - S.cfg.xmin) / (S.cfg.xmax - S.cfg.xmin) * (S.W - 1) : 0,
                          S.H > 1 ? (Z - S.cfg.zmin) / (S.cfg.zmax - S.cfg.zmin) * (S.H - 1) : 0];
const imgToScr = (cx, cy) => [S.ox + S.z * (S.fh ? S.W - cx : cx), S.oy + S.z * (S.fv ? S.H - cy : cy)];
const scrToImg = (sx, sy) => {
  const u = (sx - S.ox) / S.z, v = (sy - S.oy) / S.z;
  return [S.fh ? S.W - u : u, S.fv ? S.H - v : v];
};

/* ---- Guardado en carpeta local (File System Access API, solo modo editor) ---- */
let dirH = null, prevM = '', saveTimer = 0;
const FSA = !!window.showDirectoryPicker;
const mk = () => JSON.stringify(S.markers.map(m => [m.px, m.py, m.name, m.tier]));
const pubData = () => JSON.stringify({ cfg: S.cfg, markers: S.markers.map(({ px, py, name, tier, color }) => ({ px, py, name, tier, color })) }, null, 2) + '\n';
const fsStatus = (t, err) => { const e = $('fsstatus'); e.textContent = t; e.style.color = err ? '#fca5a5' : ''; };
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('mcmapper', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbSet = async v => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(v, 'dir'); t.oncomplete = res; t.onerror = () => rej(t.error); }); };
const idbGet = async () => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('h').objectStore('h').get('dir'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
function fsLabel() { fsStatus(dirH ? 'Carpeta: ' + dirH.name : 'Ninguna carpeta elegida.'); }
async function fsInit() {
  if (!FSA) { $('fsinfo').textContent = 'Este navegador no permite guardar en carpetas. Usa Chrome o Edge, o el botón «Exportar pois.json».'; $('fspick').disabled = $('fssave').disabled = true; return; }
  try { dirH = (await idbGet()) || null; } catch (e) {}
  fsLabel(); if (dirH) fsStatus('Carpeta: ' + dirH.name + ' · pulsa «Guardar ahora» para reactivar el permiso en esta sesión.');
  $('fspick').onclick = pickDir; $('fssave').onclick = () => saveLocal(true);
}
async function pickDir() {
  try { dirH = await showDirectoryPicker({ mode: 'readwrite' }); await idbSet(dirH).catch(() => {}); await saveLocal(true); }
  catch (e) { if (e.name !== 'AbortError') fsStatus('No se pudo abrir la carpeta.', true); }
}
async function saveLocal(user) {
  if (!dirH) return fsStatus('Elige primero la carpeta del proyecto.', true);
  try {
    let p = await dirH.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted') {
      if (!user) return fsStatus('Pulsa «Guardar ahora» para dar permiso a la carpeta.', true);
      p = await dirH.requestPermission({ mode: 'readwrite' }); if (p !== 'granted') return fsStatus('Permiso denegado.', true);
    }
    let target = dirH;
    if (dirH.name !== 'data') {
      try { await dirH.getFileHandle('index.html'); } catch (e) { return fsStatus('Esa no parece la carpeta del proyecto (no tiene index.html). Elige otra.', true); }
      target = await dirH.getDirectoryHandle('data', { create: true });
    }
    const f = await target.getFileHandle('pois.json', { create: true }), w = await f.createWritable();
    await w.write(pubData()); await w.close();
    const f2 = await target.getFileHandle('pois.js', { create: true }), w2 = await f2.createWritable();
    await w2.write('window.POIS_DATA = ' + pubData().trim() + ';\n'); await w2.close();
    fsStatus('Guardado en data/pois.json y pois.js ✔ Ya puedes hacer commit y push.'); toast('Guardado en la carpeta local');
  } catch (e) { fsStatus('No se pudo guardar: ' + (e.message || e.name), true); }
}

function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 2600);
}
const validMarker = m => m && Number.isFinite(m.px) && Number.isFinite(m.py);
const TIER_COLORS = { 1: '#facc15', 2: '#a855f7', 3: '#0091ff', 4: '#ef4444' };
const TIER_NAMES = { 4: 'Base Enemiga' };
const tierLabel = t => { const n = TIER_NAMES[(String(t).match(/\d+/) || [])[0]]; return n ? t + ' · ' + n : t; };
const tierColor = t => TIER_COLORS[(String(t).match(/\d+/) || [])[0]] || '#9ca3af';
const norm = m => ({ px: Math.round(m.px), py: Math.round(m.py), name: String(m.name || m.label || '').slice(0, 40), tier: String(m.tier || '').slice(0, 20),
  color: tierColor(m.tier), visible: m.visible !== false });
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ cfg: S.cfg, fh: S.fh, fv: S.fv, grid: S.grid, gstep: S.gstep }));
    if (EDIT) localStorage.setItem(KEY + '.m', JSON.stringify(S.markers));
  } catch (e) {}
  const k = mk();
  if (EDIT && k !== prevM) { prevM = k; if (dirH && $('fsauto').checked) { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveLocal(false), 800); } }
}
function loadSaved() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d) {
      if (d.cfg && EDIT) Object.keys(DEF).forEach(k => { if (Number.isFinite(d.cfg[k])) S.cfg[k] = d.cfg[k]; });
      S.grid = !!d.grid; if (d.gstep > 0) S.gstep = d.gstep;
    }
    if (EDIT) { const m = JSON.parse(localStorage.getItem(KEY + '.m') || '[]'); if (Array.isArray(m)) S.markers = m.filter(validMarker).map(norm); }
  } catch (e) {}
}
async function loadPois() {
  try {
    let d = null;
    try { const r = await fetch('data/pois.json', { cache: 'no-cache' }); if (r.ok) d = await r.json(); } catch (e) {}
    if (!d) d = window.POIS_DATA;   // respaldo (data/pois.js) para cuando se abre index.html como archivo local
    if (!d) return;
    if (!EDIT && d.cfg) Object.keys(DEF).forEach(k => { if (Number.isFinite(d.cfg[k])) S.cfg[k] = d.cfg[k]; });
    if (!EDIT || !S.markers.length) { S.markers = (Array.isArray(d.markers) ? d.markers : []).filter(validMarker).map(norm); prevM = mk(); }
    cfgToUI(); updateResult(); renderList();
  } catch (e) {}
  try { locate(false); } catch (e) { draw(); }
}

function resize() {
  S.dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(stage.clientWidth * S.dpr); cv.height = Math.round(stage.clientHeight * S.dpr);
  draw();
}
function fitView() {
  if (!S.img) return;
  const cw = stage.clientWidth, ch = stage.clientHeight;
  S.fit = Math.min(cw / S.W, ch / S.H) * 0.96; S.z = S.fit;
  S.ox = (cw - S.W * S.z) / 2; S.oy = (ch - S.H * S.z) / 2; draw();
}
function draw() {
  const d = S.dpr; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  if (!S.img) return;
  ctx.imageSmoothingEnabled = S.z < 1;
  const sx = S.fh ? -1 : 1, sy = S.fv ? -1 : 1;
  ctx.setTransform(d * S.z * sx, 0, 0, d * S.z * sy, d * (S.ox + (S.fh ? S.z * S.W : 0)), d * (S.oy + (S.fv ? S.z * S.H : 0)));
  ctx.drawImage(S.img, 0, 0, S.W, S.H);
  ctx.setTransform(d, 0, 0, d, 0, 0);
  if (S.grid) drawGrid();
  if (S.explore && S.zone && zoneR() > 0) drawZone();
  S.markers.forEach(m => { if (m.visible !== false) pin(m.px + .5, m.py + .5, m.color || '#ff5a5a', S.z > S.fit * 2.5 ? m.name + (m.tier ? ' · ' + tierLabel(m.tier) : '') : ''); });
  if (S.sel) pin(S.sel[0] + .5, S.sel[1] + .5, '#fde047', null, true);
  if (S.me) drawMe();
}
function drawGrid() {
  const c = S.cfg, step = Math.max(1, S.gstep);
  const [ax, ay] = imgToScr(0, 0), [bx, by] = imgToScr(S.W, S.H);
  const L = Math.min(ax, bx), R = Math.max(ax, bx), T = Math.min(ay, by), B = Math.max(ay, by);   // borde del mapa en pantalla
  const vl = Math.max(L, 0), vt = Math.max(T, 0);                                                  // parte visible, para las etiquetas
  ctx.save(); ctx.beginPath(); ctx.rect(L, T, R - L, B - T); ctx.clip();                           // nada se dibuja fuera del mapa
  ctx.lineWidth = 1; ctx.font = '11px Monocraft, ui-monospace, monospace'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(255,255,255,.28)';
  const lines = (lo, hi, isX) => {
    if ((hi - lo) / step > 400) return;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const [cx, cy] = isX ? mcToPx(v, c.zmin) : mcToPx(c.xmin, v);
      const [sx, sy] = imgToScr(isX ? cx + .5 : 0, isX ? 0 : cy + .5);
      ctx.beginPath();
      if (isX) { if (sx < L || sx > R) continue; ctx.moveTo(Math.round(sx) + .5, T); ctx.lineTo(Math.round(sx) + .5, B); ctx.stroke(); ctx.fillText(v, sx + 3, vt + 12); }
      else { if (sy < T || sy > B) continue; ctx.moveTo(L, Math.round(sy) + .5); ctx.lineTo(R, Math.round(sy) + .5); ctx.stroke(); ctx.fillText(v, vl + 3, sy - 3); }
    }
  };
  lines(Math.min(c.xmin, c.xmax), Math.max(c.xmin, c.xmax), true);
  lines(Math.min(c.zmin, c.zmax), Math.max(c.zmin, c.zmax), false);
  ctx.restore();
}
function pin(cx, cy, color, label, ring) {
  const [x, y] = imgToScr(cx, cy);
  ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, ring ? 9 : 6, 0, 7); ctx.fill(); ctx.stroke();
  if (ring) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x - 11, y); ctx.moveTo(x + 11, y); ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 11); ctx.moveTo(x, y + 11); ctx.lineTo(x, y + 16); ctx.stroke(); }
  if (label) { ctx.font = '12px Monocraft, ui-monospace, monospace'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(label, x + 10, y - 8); ctx.fillStyle = '#fff'; ctx.fillText(label, x + 10, y - 8); }
  ctx.restore();
}

function zoomAt(sx, sy, f) {
  const nz = Math.min(64, Math.max(S.fit * 0.5, S.z * f)); if (nz === S.z) return;
  S.ox = sx - (sx - S.ox) * nz / S.z; S.oy = sy - (sy - S.oy) * nz / S.z; S.z = nz; draw();
}
const rel = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = rel(e); zoomAt(x, y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
const ptrs = new Map(); let moved = 0, pinch = 0;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, rel(e)); moved = 0; pinch = 0; cv.classList.add('drag'); });
cv.addEventListener('pointermove', e => {
  const p = rel(e);
  if (ptrs.has(e.pointerId)) {
    const o = ptrs.get(e.pointerId); ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) { S.ox += p[0] - o[0]; S.oy += p[1] - o[1]; moved += Math.abs(p[0] - o[0]) + Math.abs(p[1] - o[1]); draw(); }
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, dist / pinch); pinch = dist; moved = 99;
    }
  }
  if (S.img) {
    const [cx, cy] = scrToImg(p[0], p[1]), px = Math.floor(cx), py = Math.floor(cy);
    const inside = px >= 0 && py >= 0 && px < S.W && py < S.H;
    $('hover').textContent = inside ? `X ${toMC(px, py)[0]}  Z ${toMC(px, py)[1]}` : '—';
  }
});
const up = e => {
  if (ptrs.has(e.pointerId) && ptrs.size === 1 && moved < 5 && e.type === 'pointerup' && S.img) {
    const [cx, cy] = scrToImg(...rel(e)), px = Math.floor(cx), py = Math.floor(cy);
    if (px >= 0 && py >= 0 && px < S.W && py < S.H) select(px, py);
  }
  ptrs.delete(e.pointerId); pinch = 0; if (!ptrs.size) cv.classList.remove('drag');
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
$('zin').onclick = () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.5);
$('zout').onclick = () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.5);
$('zfit').onclick = fitView;

function select(px, py) {
  S.sel = [px, py]; if (S.explore) { const [X, Z] = toMC(px, py); S.zone = { X, Z }; }
  updateResult(); refreshZone(); draw();
}
function updateResult() {
  if (!S.sel) { $('rx').textContent = $('rz').textContent = '—'; $('selhint').style.display = ''; return; }
  const [X, Z] = toMC(S.sel[0], S.sel[1]);
  $('rx').textContent = X; $('rz').textContent = Z; $('selhint').style.display = 'none';
}
function fallback(txt, done) {
  const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('No se pudo copiar', true); } t.remove();
}
function copy(fmt) {
  if (!S.sel) return toast('Selecciona un punto primero', true);
  const [X, Z] = toMC(S.sel[0], S.sel[1]);
  const txt = fmt === 1 ? `X: ${X}, Z: ${Z}` : fmt === 2 ? `${X} ${Z}` : `/tp @s ${X} ~ ${Z}`;
  const done = () => toast('Copiado: ' + txt);
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, () => fallback(txt, done));
  else fallback(txt, done);
}
$('c1').onclick = () => copy(1); $('c3').onclick = () => copy(3);

const cfgIds = ['xmin', 'xmax', 'zmin', 'zmax'];
function cfgToUI() { cfgIds.forEach(k => $(k).value = S.cfg[k]); }
cfgIds.forEach(k => $(k).oninput = () => {
  const v = $(k).value.trim(), n = Number(v), good = v !== '' && Number.isFinite(n);
  $(k).classList.toggle('bad', !good); if (!good) return;
  S.cfg[k] = n; save(); updateResult(); renderList(); draw();
});
$('rcfg').onclick = () => { S.cfg = { ...DEF }; cfgToUI(); cfgIds.forEach(k => $(k).classList.remove('bad')); save(); updateResult(); renderList(); draw(); toast('Configuración restablecida'); };
$('grid').onchange = () => { S.grid = $('grid').checked; save(); draw(); };
$('gstep').oninput = () => { const n = Number($('gstep').value); if (n >= 1) { S.gstep = n; save(); draw(); } };
const openF = new Set();
function centerOn(px, py) {
  S.z = Math.max(S.z, S.fit * 3);
  const [x, y] = imgToScr(px + .5, py + .5); S.ox += stage.clientWidth / 2 - x; S.oy += stage.clientHeight / 2 - y; draw();
}
function mkBtn(txt, title, fn) { const b = document.createElement('button'); b.textContent = txt; b.title = title; b.style.padding = '2px 7px';
  b.onclick = e => { e.preventDefault(); e.stopPropagation(); fn(); }; return b; }
function folder(title, arr, id, q) {
  const d = document.createElement('details'), s = document.createElement('summary');
  d.open = !!q || openF.has(id); d.ontoggle = () => { d.open ? openF.add(id) : openF.delete(id); };
  const t = document.createElement('span'); t.className = 't'; t.textContent = '📁 ' + title;
  const n = document.createElement('span'); n.className = 'n'; n.textContent = arr.length;
  const allVis = arr.every(o => o.m.visible !== false);
  s.append(t, n, mkBtn(allVis ? '👁' : '🚫', 'Mostrar/ocultar carpeta', () => { arr.forEach(o => o.m.visible = !allVis); save(); renderList(); draw(); }));
  if (EDIT) { const x = mkBtn('✕', 'Eliminar carpeta', () => {
    if (!confirm(`¿Eliminar ${arr.length} punto(s) de «${title}»?`)) return;
    const del = new Set(arr.map(o => o.m)); S.markers = S.markers.filter(m => !del.has(m)); save(); renderList(); draw(); }); s.appendChild(x); }
  d.appendChild(s); return d;
}
function pointRow(o) {
  const m = o.m, [X, Z] = toMC(m.px, m.py), r = document.createElement('div'); r.className = 'pt';
  const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = m.color;
  const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = `X ${X}, Z ${Z}`;
  nm.onclick = () => { select(m.px, m.py); centerOn(m.px, m.py); };
  r.append(dot, nm, mkBtn(m.visible === false ? '🚫' : '👁', 'Mostrar/ocultar', () => { m.visible = m.visible === false; save(); renderList(); draw(); }));
  if (EDIT) r.appendChild(mkBtn('✕', 'Eliminar', () => { S.markers.splice(o.i, 1); save(); renderList(); draw(); }));
  return r;
}
function renderList() {
  const ul = $('mlist'); ul.textContent = '';
  const q = $('msearch').value.trim().toLowerCase(), mode = $('mgroup').value;
  const items = S.markers.map((m, i) => ({ m, i })).filter(({ m }) => !q || (m.name + ' ' + tierLabel(m.tier)).toLowerCase().includes(q));
  $('mcount').textContent = `· ${items.length}/${S.markers.length}`;
  const k1 = mode === 'nt' ? 'name' : 'tier', k2 = mode === 'nt' ? 'tier' : 'name';
  const by = (arr, k) => { const g = new Map();
    arr.forEach(o => { const key = o.m[k] || (k === 'name' ? '(sin nombre)' : '(sin tier)'); if (!g.has(key)) g.set(key, []); g.get(key).push(o); });
    return [...g].sort((x, y) => x[0].localeCompare(y[0], 'es', { numeric: true })); };
  by(items, k1).forEach(([a, arrA]) => {
    const f1 = folder(k1 === 'tier' ? tierLabel(a) : a, arrA, mode + '|' + a, q);
    by(arrA, k2).forEach(([b, arrB]) => {
      const f2 = folder(k2 === 'tier' ? tierLabel(b) : b, arrB, mode + '|' + a + '|' + b, q);
      arrB.forEach(o => f2.appendChild(pointRow(o))); f1.appendChild(f2);
    });
    ul.appendChild(f1);
  });
  const fill = (id, k) => { const dl = $(id); dl.textContent = '';
    [...new Set(S.markers.map(m => m[k]).concat(k === 'tier' ? ['1', '2', '3', '4'] : []).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es', { numeric: true }))
      .forEach(v => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); }); };
  fill('dlname', 'name'); fill('dltier', 'tier');
  renderExcl(); refreshZone();
}
$('mgroup').onchange = $('msearch').oninput = renderList;
$('madd').onclick = () => {
  if (!S.sel) return toast('Selecciona un punto primero', true);
  const name = $('mname').value.trim(); if (!name) return toast('Escribe un nombre', true);
  if (S.markers.some(m => m.px === S.sel[0] && m.py === S.sel[1] && m.name === name)) return toast('Ya existe ese punto con ese nombre', true);
  S.markers.push(norm({ px: S.sel[0], py: S.sel[1], name, tier: $('mtier').value.trim() }));
  save(); renderList(); draw(); toast('Punto guardado');
};
function download(name, txt, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('mexp').onclick = () => download('pois.json', JSON.stringify({ cfg: S.cfg, markers: S.markers }, null, 2), 'application/json');
$('mcsv').onclick = () => {
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  download('marcadores.csv', 'nombre,tier,x,z,pixel_x,pixel_y,color\n' + S.markers.map(m => { const [X, Z] = toMC(m.px, m.py);
    return [q(m.name || ''), q(m.tier || ''), X, Z, m.px, m.py, m.color].join(','); }).join('\n'), 'text/csv');
};
$('mimp').onclick = () => $('mfile').click();
$('mfile').onchange = async () => {
  const f = $('mfile').files[0]; $('mfile').value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text()), arr = Array.isArray(d) ? d : d.markers;
    if (!Array.isArray(arr)) throw 0;
    const ok = arr.filter(validMarker).map(norm);
    S.markers.push(...ok); save(); renderList(); draw(); toast(`Importados ${ok.length} marcadores`);
  } catch (e) { toast('Archivo JSON no válido', true); }
};

/* ---- Mi posición: acepta F3+C (/execute in … run tp @s X Y Z yaw pitch), "X: 1, Z: 2", "1 2", "1 74 2"… ---- */
const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)|~/g;
function parsePos(txt) {
  txt = String(txt || '').trim(); if (!txt) return null;
  let dim = 'overworld'; const dm = txt.match(/\bin\s+(?:minecraft:)?(\w+)/i); if (dm) dim = dm[1].toLowerCase();
  let n = null;
  const tp = txt.match(/\b(?:tp|teleport)\s+(?:@\w+(?:\[[^\]]*\])?|[\w.-]+?)\s+([-+~\d.].*)$/i);
  if (tp) n = tp[1].match(NUM);                                   // F3+C / comando tp
  else {
    const g = l => { const m = txt.match(new RegExp('(?:^|[^a-z])' + l + '\\s*[:=]\\s*([-+]?(?:\\d+\\.?\\d*|\\.\\d+))', 'i')); return m ? parseFloat(m[1]) : null; };
    const x = g('x'), z = g('z');
    if (x !== null && z !== null) n = [x, g('y'), z].filter(v => v !== null).map(String); // "X: 1, Y: 2, Z: 3"
    else n = txt.match(NUM);                                        // "1 2", "1, 74, 2", "XYZ: 1 / 74 / 2"
  }
  if (!n) return { err: 'No encuentro coordenadas en ese texto.' };
  if (n.includes('~')) return { err: 'Las coordenadas relativas (~) no valen; usa las absolutas de F3+C.' };
  n = n.map(Number);
  let X, Y = null, Z, yaw = null;
  if (n.length === 2) [X, Z] = n;
  else if (n.length === 3) [X, Y, Z] = n;
  else if (n.length === 5) [X, Y, Z, yaw] = n;
  else return { err: `Esperaba 2 (X Z), 3 (X Y Z) o 5 (F3+C) números y he leído ${n.length}.` };
  if (![X, Z].every(Number.isFinite)) return { err: 'Coordenadas no válidas.' };
  let note = '';
  if (dim === 'the_nether') { X *= 8; Z *= 8; note = 'Estás en el Nether: convertido ×8 a coordenadas del Overworld.'; }
  else if (dim === 'the_end') return { err: 'Estás en el End: el mapa es del Overworld.' };
  return { X, Y, Z, yaw, note };
}
const compass = (dx, dz) => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round((Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360 / 45) % 8];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = v => (Math.round(v * 10) / 10).toString();
function drawMe() {
  const m = S.me, [px, py] = mcToPx(m.X, m.Z); if (!(px >= 0 && py >= 0 && px <= S.W - 1 && py <= S.H - 1)) return;
  const [x, y] = imgToScr(px + .5, py + .5);
  ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#22d3ee';
  if (m.yaw !== null) {   // la flecha apunta hacia donde miras (yaw 0 = sur/+Z, 90 = oeste/-X)
    const r = m.yaw * Math.PI / 180, dx = -Math.sin(r), dz = Math.cos(r);
    const [bx, by] = mcToPx(m.X + dx, m.Z + dz), [tx, ty] = imgToScr(bx + .5, by + .5);
    const a = Math.atan2(ty - y, tx - x);
    ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(7, -8); ctx.lineTo(7, 8); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  }
  ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
  if (S.z > S.fit * 2.5) { ctx.font = '12px Monocraft, ui-monospace, monospace'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText('Tú', x + 12, y - 12); ctx.fillStyle = '#fff'; ctx.fillText('Tú', x + 12, y - 12); }
  ctx.restore();
}
function locate(center) {
  const el = $('posout'), raw = $('pos').value, p = parsePos(raw);
  try { localStorage.setItem(KEY + '.pos', raw); } catch (e) {}
  $('pos').classList.remove('bad'); el.classList.remove('err');
  if (!p) { S.me = null; el.textContent = 'Pega aquí lo que te da F3+C o escribe las coordenadas a mano.'; el.classList.add('muted'); draw(); return; }
  el.classList.remove('muted');
  if (p.err) { S.me = null; $('pos').classList.add('bad'); el.classList.add('err'); el.textContent = p.err; draw(); return; }
  S.me = p;
  const c = S.cfg, inside = p.X >= c.xmin && p.X <= c.xmax && p.Z >= c.zmin && p.Z <= c.zmax;
  let html = `<span class="me">Estás en</span> <b>X ${f1(p.X)}</b> · <b>Z ${f1(p.Z)}</b>` + (p.Y !== null ? ` · Y ${f1(p.Y)}` : '');
  if (p.yaw !== null) html += ` · mirando al <b>${compass(-Math.sin(p.yaw * Math.PI / 180), Math.cos(p.yaw * Math.PI / 180))}</b>`;
  if (p.note) html += `<br>${esc(p.note)}`;
  if (!inside) html += '<br>⚠ Estás fuera de los límites del mapa.';
  else {
    const near = S.markers.filter(m => m.visible !== false).map(m => { const [X, Z] = toMC(m.px, m.py); return { m, X, Z, d: Math.hypot(X - p.X, Z - p.Z) }; })
      .sort((a, b) => a.d - b.d).slice(0, 3);
    if (near.length) html += '<br>Más cerca:<ul>' + near.map(o => `<li><b>${esc(o.m.name || '(sin nombre)')}</b>${o.m.tier ? ' · T' + esc(o.m.tier) : ''} — ${Math.round(o.d)} bloques al ${compass(o.X - p.X, o.Z - p.Z)} <span class="muted">(X ${o.X}, Z ${o.Z})</span></li>`).join('') + '</ul>';
  }
  el.innerHTML = html;
  if (center && inside) { const [px, py] = mcToPx(p.X, p.Z); centerOn(Math.round(px), Math.round(py)); } else draw();
}
$('pos').oninput = () => locate(false);
$('pos').onpaste = () => setTimeout(() => locate(true), 0);
$('pos').onkeydown = e => { if (e.key === 'Enter') locate(true); };
$('posgo').onclick = () => locate(true);
$('posclr').onclick = () => { $('pos').value = ''; locate(false); };

/* ---- Explorar zona + Mejor zona ---- */
const TIER_PTS = { 1: 7, 2: 3, 3: 1 };
const tierNum = t => parseInt((String(t).match(/\d+/) || [])[0], 10);
const skey = m => (m.name || '') + '|' + (m.tier || '');
let excl = new Set(); try { excl = new Set(JSON.parse(localStorage.getItem(KEY + '.excl') || '[]')); } catch (e) {}
const saveExcl = () => { try { localStorage.setItem(KEY + '.excl', JSON.stringify([...excl])); } catch (e) {} };
const basePts = m => TIER_PTS[tierNum(m.tier)] || 0;
const worth = m => excl.has(skey(m)) ? 0 : basePts(m);
const structs = () => S.markers.map(m => { const [X, Z] = toMC(m.px, m.py); return { m, X, Z }; });
const tierTxt = t => { const n = tierNum(t); return isNaN(n) ? 'sin tier' : 'Tier ' + n + (TIER_NAMES[n] ? ' · ' + TIER_NAMES[n] : ''); };
const zoneR = () => Math.max(0, Number($('xr').value) || 0);
const ppb = () => [(S.W - 1) / Math.abs(S.cfg.xmax - S.cfg.xmin || 1), (S.H - 1) / Math.abs(S.cfg.zmax - S.cfg.zmin || 1)];

function drawZone() {
  const r = zoneR(), [px, py] = mcToPx(S.zone.X, S.zone.Z), [x, y] = imgToScr(px + .5, py + .5), [bx, by] = ppb();
  ctx.save(); ctx.beginPath(); ctx.ellipse(x, y, S.z * r * bx, S.z * r * by, 0, 0, 7);
  ctx.fillStyle = 'rgba(250,204,21,.12)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#facc15'; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.restore();
}
function focusZone() {
  const r = zoneR(); if (!S.zone || !(r > 0)) return draw();
  const [bx] = ppb(), want = Math.min(stage.clientWidth, stage.clientHeight) * 0.7 / (2 * r * bx);
  S.z = Math.min(64, Math.max(S.fit, want));
  const [px, py] = mcToPx(S.zone.X, S.zone.Z), [x, y] = imgToScr(px + .5, py + .5);
  S.ox += stage.clientWidth / 2 - x; S.oy += stage.clientHeight / 2 - y; draw();
}
function refreshZone() {
  const el = $('xout'), r = zoneR(), z = S.zone;
  $('xtoggle').textContent = S.explore ? 'Desactivar' : 'Activar'; $('xtoggle').classList.toggle('on', S.explore);
  if (!S.explore) { el.innerHTML = ''; return; }
  if (!z) { el.innerHTML = '<span class="muted">Pulsa en el mapa para elegir el centro de la zona.</span>'; return; }
  if (!(r > 0)) { el.innerHTML = '<span class="muted">Escribe un radio mayor que 0.</span>'; return; }
  const inn = structs().map(o => ({ ...o, d: Math.hypot(o.X - z.X, o.Z - z.Z) })).filter(o => o.d <= r).sort((a, b) => a.d - b.d);
  let html = `<div>Centro <b>X ${z.X}</b> · <b>Z ${z.Z}</b> · radio ${r}</div>`;
  if (!inn.length) { el.innerHTML = html + '<div class="muted">No hay ninguna estructura en esa zona.</div>'; return; }
  const pts = inn.reduce((s, o) => s + worth(o.m), 0), cnt = new Map();
  inn.forEach(o => { const t = tierNum(o.m.tier); cnt.set(t, (cnt.get(t) || 0) + 1); });
  html += `<div><b>${inn.length}</b> estructuras · <b>${pts}</b> puntos</div><div class="chips">` +
    [...cnt].sort((a, b) => (a[0] || 99) - (b[0] || 99)).map(([t, n]) => `<span style="border-color:${TIER_COLORS[t] || '#9ca3af'}">${t ? 'Tier ' + t + (TIER_NAMES[t] ? ' · ' + TIER_NAMES[t] : '') : 'Otras'} ×${n}</span>`).join('') + '</div>';
  const g = new Map(); inn.forEach(o => { const k = skey(o.m); if (!g.has(k)) g.set(k, []); g.get(k).push(o); });
  [...g.values()].sort((a, b) => ((tierNum(a[0].m.tier) || 99) - (tierNum(b[0].m.tier) || 99)) || String(a[0].m.name).localeCompare(String(b[0].m.name), 'es')).forEach(arr => {
    const m = arr[0].m, off = excl.has(skey(m)) || !basePts(m);
    html += `<details class="${off ? 'off' : ''}"><summary><span class="dot" style="background:${esc(m.color || '#9ca3af')}"></span>${esc(m.name || '(sin nombre)')} · ${esc(tierTxt(m.tier))} ×${arr.length}${excl.has(skey(m)) ? ' · no cuenta' : ''}</summary>` +
      arr.map(o => `<div class="it" data-px="${o.m.px}" data-py="${o.m.py}">X ${o.X}, Z ${o.Z} — ${Math.round(o.d)} bloques${o.d >= 1 ? ' al ' + compass(o.X - z.X, o.Z - z.Z) : ''}</div>`).join('') + '</details>';
  });
  el.innerHTML = html;
}
$('xout').onclick = e => { const it = e.target.closest('.it'); if (!it) return; const px = +it.dataset.px, py = +it.dataset.py; S.sel = [px, py]; updateResult(); centerOn(px, py); };
$('xr').oninput = () => { refreshZone(); draw(); };
$('xtoggle').onclick = () => {
  S.explore = !S.explore;
  if (S.explore && S.sel) { const [X, Z] = toMC(S.sel[0], S.sel[1]); S.zone = { X, Z }; }
  refreshZone(); draw();
};
function viewZone(X, Z, r) {
  $('xr').value = r; S.explore = true; S.zone = { X, Z };
  const [px, py] = mcToPx(X, Z); S.sel = [Math.min(S.W - 1, Math.max(0, Math.round(px))), Math.min(S.H - 1, Math.max(0, Math.round(py)))];
  updateResult(); refreshZone(); focusZone();
}

/* Mejor zona: el centro óptimo siempre es un punto o el centro de un círculo de radio R que pasa por dos puntos. */
function bestZones(R, top) {
  const pts = structs().map(o => ({ X: o.X, Z: o.Z, w: worth(o.m), t: tierNum(o.m.tier) })).filter(p => p.w > 0);
  if (!pts.length) return [];
  const c = S.cfg, x0 = Math.min(c.xmin, c.xmax), x1 = Math.max(c.xmin, c.xmax), z0 = Math.min(c.zmin, c.zmax), z1 = Math.max(c.zmin, c.zmax), R2 = R * R;
  const cand = new Map(), add = (x, z) => { x = Math.round(x); z = Math.round(z); if (x >= x0 && x <= x1 && z >= z0 && z <= z1) cand.set(x + ',' + z, [x, z]); };
  pts.forEach(p => add(p.X, p.Z));
  for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) {
    const dx = pts[k].X - pts[i].X, dz = pts[k].Z - pts[i].Z, d2 = dx * dx + dz * dz;
    if (!d2 || d2 > 4 * R2) continue;
    const d = Math.sqrt(d2), h = Math.sqrt(R2 - d2 / 4), mx = (pts[i].X + pts[k].X) / 2, mz = (pts[i].Z + pts[k].Z) / 2, ux = -dz / d, uz = dx / d;
    add(mx + ux * h, mz + uz * h); add(mx - ux * h, mz - uz * h);
  }
  const at = (x, z) => { let s = 0, n = 0; for (const p of pts) { const dx = p.X - x, dz = p.Z - z; if (dx * dx + dz * dz <= R2) { s += p.w; n++; } } return [s, n]; };
  const list = [...cand.values()].map(([x, z]) => ({ x, z, s: at(x, z)[0] })).sort((a, b) => b.s - a.s);
  const out = [];
  for (const q of list) {
    if (out.length >= top) break;
    if (out.some(o => Math.hypot(o.x0 - q.x, o.z0 - q.z) < R)) continue;
    let x = q.x, z = q.z, s = q.s;
    const mem = pts.filter(p => (p.X - x) ** 2 + (p.Z - z) ** 2 <= R2);      // centramos el círculo sobre sus estructuras si no pierde puntos
    const cx = Math.round(mem.reduce((a, p) => a + p.X, 0) / mem.length), cz = Math.round(mem.reduce((a, p) => a + p.Z, 0) / mem.length);
    if (at(cx, cz)[0] >= s) { x = cx; z = cz; }
    const inn = pts.filter(p => (p.X - x) ** 2 + (p.Z - z) ** 2 <= R2), by = {};
    inn.forEach(p => by[p.t] = (by[p.t] || 0) + 1);
    out.push({ x, z, x0: q.x, z0: q.z, s: inn.reduce((a, p) => a + p.w, 0), n: inn.length, by });
  }
  return out;
}
let lastCalc = false;
function runCalc() {
  const out = $('cout'), R = Number($('cr').value); out.classList.remove('err');
  if (!(R >= 1)) { out.classList.add('err'); out.textContent = 'Escribe un radio válido (mínimo 1).'; return; }
  const res = bestZones(R, 3); lastCalc = true;
  if (!res.length) { out.classList.add('err'); out.textContent = 'No hay estructuras que puntúen. Marca alguna en «Estructuras que cuentan».'; return; }
  out.innerHTML = res.map((o, i) => `<div class="best"><b>#${i + 1}</b> · <b class="sc">${o.s} puntos</b><br>Centro <b>X ${o.x}</b> · <b>Z ${o.z}</b> · ${o.n} estructuras<br>` +
    `<span class="muted">${[1, 2, 3].filter(t => o.by[t]).map(t => `${o.by[t]}× Tier ${t}`).join(' · ')}</span><br>` +
    `<button data-x="${o.x}" data-z="${o.z}" data-r="${R}">Ver en el mapa</button></div>`).join('');
}
$('cgo').onclick = runCalc;
$('cr').onkeydown = e => { if (e.key === 'Enter') runCalc(); };
$('cout').onclick = e => { const b = e.target.closest('button[data-x]'); if (b) viewZone(+b.dataset.x, +b.dataset.z, +b.dataset.r); };
let cTier = 0;   // 0 = todos los tiers
const inTier = m => !cTier || tierNum(m.tier) === cTier;
function renderExcl() {
  const box = $('clist'); box.textContent = '';
  const g = new Map(); S.markers.forEach(m => { if (!basePts(m)) return; const k = skey(m); if (!g.has(k)) g.set(k, { m, n: 0 }); g.get(k).n++; });
  const all = [...g].sort((a, b) => (tierNum(a[1].m.tier) - tierNum(b[1].m.tier)) || String(a[1].m.name).localeCompare(String(b[1].m.name), 'es'));
  const arr = all.filter(([, o]) => inTier(o.m));
  arr.forEach(([k, o]) => {
    const l = document.createElement('label'), cb = document.createElement('input'); l.className = 'chk'; cb.type = 'checkbox'; cb.checked = !excl.has(k);
    cb.onchange = () => { cb.checked ? excl.delete(k) : excl.add(k); saveExcl(); renderExcl(); refreshZone(); if (lastCalc) runCalc(); };
    l.append(cb, ` ${o.m.name || '(sin nombre)'} · Tier ${tierNum(o.m.tier)} · ×${o.n} · ${basePts(o.m)} pt`); box.appendChild(l);
  });
  if (!arr.length) box.innerHTML = '<span class="muted small">No hay estructuras de este tier.</span>';
  document.querySelectorAll('#ctiers button').forEach(b => b.classList.toggle('on', +b.dataset.t === cTier));
  $('call').textContent = cTier ? `Marcar Tier ${cTier}` : 'Marcar todas'; $('cnone').textContent = cTier ? `Quitar Tier ${cTier}` : 'Quitar todas';
  const off = all.filter(([k]) => excl.has(k)).length; $('ccount').textContent = off ? `· ${off} quitada${off > 1 ? 's' : ''}` : '';
}
$('ctiers').onclick = e => { const b = e.target.closest('button[data-t]'); if (!b) return; cTier = +b.dataset.t; renderExcl(); };
$('call').onclick = () => { S.markers.forEach(m => { if (basePts(m) && inTier(m)) excl.delete(skey(m)); }); saveExcl(); renderExcl(); refreshZone(); if (lastCalc) runCalc(); };
$('cnone').onclick = () => { S.markers.forEach(m => { if (basePts(m) && inTier(m)) excl.add(skey(m)); }); saveExcl(); renderExcl(); refreshZone(); if (lastCalc) runCalc(); };

function setImage(img, name) {
  S.img = img; S.W = img.naturalWidth || img.width; S.H = img.naturalHeight || img.height;
  $('dims').textContent = `${name} · ${S.W} × ${S.H} px`; S.sel = null;
  updateResult(); renderList(); fitView();
}
function loadFile(f) {
  if (!f) return;
  if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) return toast('Formato no admitido. Usa PNG, JPG o WebP.', true);
  const url = URL.createObjectURL(f), img = new Image();
  img.onload = () => {
    if (img.naturalWidth * img.naturalHeight > 100e6) { URL.revokeObjectURL(url); return toast('Imagen demasiado grande (máx. ~100 MP).', true); }
    setImage(img, f.name); URL.revokeObjectURL(url);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('No se pudo leer la imagen.', true); };
  img.src = url;
}
function loadDefault() {
  const img = new Image();
  img.onload = () => setImage(img, 'images/mapa.png');
  img.onerror = () => { $('dims').textContent = 'No se encontró images/mapa.png. Carga una imagen manualmente.'; toast('No se pudo cargar images/mapa.png', true); };
  img.src = 'images/mapa.png';
}
$('load').onclick = () => $('file').click();
$('file').onchange = () => { loadFile($('file').files[0]); $('file').value = ''; };
$('defimg').onclick = loadDefault;
let dc = 0;
addEventListener('dragenter', e => { e.preventDefault(); dc++; $('drop').classList.add('show'); });
addEventListener('dragleave', () => { if (--dc <= 0) { dc = 0; $('drop').classList.remove('show'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dc = 0; $('drop').classList.remove('show'); loadFile(e.dataTransfer.files[0]); });
$('toggle').onclick = () => { $('panel').classList.toggle('hidden'); setTimeout(() => { resize(); fitView(); }, 50); };
addEventListener('resize', resize);

loadSaved(); prevM = mk(); if (EDIT) fsInit(); cfgToUI(); $('grid').checked = S.grid; $('gstep').value = S.gstep; renderList();
if (innerWidth <= 800) $('panel').classList.add('hidden');
try { $('pos').value = localStorage.getItem(KEY + '.pos') || ''; } catch (e) {} locate(false);
resize(); loadDefault(); loadPois();
if (document.fonts && document.fonts.load) document.fonts.load('12px Monocraft').then(draw, () => {});
})();
