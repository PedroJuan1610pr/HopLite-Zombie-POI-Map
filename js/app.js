(() => {
'use strict';
const $ = id => document.getElementById(id);
const cv = $('map'), ctx = cv.getContext('2d'), stage = $('stage');
const DEF = { xmin: -3499, xmax: 3499, zmin: -3499, zmax: 3499 };
const S = { img: null, W: 0, H: 0, z: 1, ox: 0, oy: 0, fit: 1, fh: false, fv: false,
  sel: null, markers: [], grid: false, gstep: 500, cfg: { ...DEF }, dpr: 1 };
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

/* ---- Publicación en GitHub (solo modo editor) ---- */
const GH_KEY = 'mcmapper.gh', gh = { owner: '', repo: '', token: '', auto: true };
let prevM = '', pubTimer = 0, pubBusy = false;
const mk = () => JSON.stringify(S.markers.map(m => [m.px, m.py, m.name, m.tier]));
const pubData = () => JSON.stringify({ cfg: S.cfg, markers: S.markers.map(({ px, py, name, tier, color }) => ({ px, py, name, tier, color })) }, null, 2) + '\n';
function ghStatus(t, err) { const e = $('ghstatus'); e.textContent = t; e.style.color = err ? '#fca5a5' : ''; }
function ghInit() {
  try { Object.assign(gh, JSON.parse(localStorage.getItem(GH_KEY) || '{}')); } catch (e) {}
  if (!gh.owner && location.hostname.endsWith('.github.io')) { gh.owner = location.hostname.split('.')[0]; gh.repo = location.pathname.split('/')[1] || ''; }
  $('ghowner').value = gh.owner; $('ghrepo').value = gh.repo; $('ghtoken').value = gh.token; $('ghauto').checked = gh.auto;
  const store = () => { gh.owner = $('ghowner').value.trim(); gh.repo = $('ghrepo').value.trim(); gh.token = $('ghtoken').value.trim(); gh.auto = $('ghauto').checked;
    try { localStorage.setItem(GH_KEY, JSON.stringify(gh)); } catch (e) {} };
  ['ghowner', 'ghrepo', 'ghtoken', 'ghauto'].forEach(id => $(id).oninput = $(id).onchange = store);
  $('ghpub').onclick = () => { store(); clearTimeout(pubTimer); publish(); };
}
async function publish() {
  if (!gh.token || !gh.owner || !gh.repo) return ghStatus('Falta usuario, repositorio o token.', true);
  if (pubBusy) { pubTimer = setTimeout(publish, 1500); return; }
  pubBusy = true; ghStatus('Publicando…');
  const url = `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/data/pois.json`;
  const H = { Authorization: 'Bearer ' + gh.token, Accept: 'application/vnd.github+json' };
  try {
    const bytes = new TextEncoder().encode(pubData()); let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
    let code = 0;
    for (let t = 0; t < 2; t++) {
      const g = await fetch(url, { headers: H, cache: 'no-store' }); let sha;
      if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw g.status;
      const p = await fetch(url, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Actualizar POIs desde la web', content: btoa(bin), sha }) });
      if (p.ok) { ghStatus('Publicado ✔ La web pública se actualiza en 1-2 min.'); toast('Publicado en GitHub'); return; }
      code = p.status; if (code !== 409 && code !== 422) break;
    }
    throw code;
  } catch (c) {
    ghStatus(c === 401 ? 'Token no válido o caducado.' : (c === 403 || c === 404) ? 'Sin permiso: el token necesita «Contents: Read and write» sobre este repositorio.' :
      'No se pudo publicar (' + (c && c.message ? 'sin conexión' : c) + ').', true);
  } finally { pubBusy = false; }
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
  if (EDIT && k !== prevM) { prevM = k; if (gh.auto && gh.token) { clearTimeout(pubTimer); pubTimer = setTimeout(publish, 2000); } }
}
function loadSaved() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d) {
      if (d.cfg && EDIT) Object.keys(DEF).forEach(k => { if (Number.isFinite(d.cfg[k])) S.cfg[k] = d.cfg[k]; });
      S.fh = !!d.fh; S.fv = !!d.fv; S.grid = !!d.grid; if (d.gstep > 0) S.gstep = d.gstep;
    }
    if (EDIT) { const m = JSON.parse(localStorage.getItem(KEY + '.m') || '[]'); if (Array.isArray(m)) S.markers = m.filter(validMarker).map(norm); }
  } catch (e) {}
}
async function loadPois() {
  try {
    const r = await fetch('data/pois.json', { cache: 'no-cache' }); if (!r.ok) return;
    const d = await r.json();
    if (!EDIT && d.cfg) Object.keys(DEF).forEach(k => { if (Number.isFinite(d.cfg[k])) S.cfg[k] = d.cfg[k]; });
    if (!EDIT || !S.markers.length) { S.markers = (Array.isArray(d.markers) ? d.markers : []).filter(validMarker).map(norm); prevM = mk(); }
    cfgToUI(); updateResult(); renderList(); draw();
  } catch (e) {}
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
  S.markers.forEach(m => { if (m.visible !== false) pin(m.px + .5, m.py + .5, m.color || '#ff5a5a', S.z > S.fit * 2.5 ? m.name + (m.tier ? ' · ' + tierLabel(m.tier) : '') : ''); });
  if (S.sel) pin(S.sel[0] + .5, S.sel[1] + .5, '#fde047', null, true);
}
function drawGrid() {
  const c = S.cfg, step = Math.max(1, S.gstep), w = stage.clientWidth, h = stage.clientHeight;
  ctx.lineWidth = 1; ctx.font = '11px system-ui'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(255,255,255,.28)';
  const lines = (lo, hi, isX) => {
    if ((hi - lo) / step > 400) return;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const [cx, cy] = isX ? mcToPx(v, c.zmin) : mcToPx(c.xmin, v);
      const [sx, sy] = imgToScr(isX ? cx + .5 : 0, isX ? 0 : cy + .5);
      ctx.beginPath();
      if (isX) { ctx.moveTo(Math.round(sx) + .5, 0); ctx.lineTo(Math.round(sx) + .5, h); if (sx > 0 && sx < w) ctx.fillText(v, sx + 3, 12); }
      else { ctx.moveTo(0, Math.round(sy) + .5); ctx.lineTo(w, Math.round(sy) + .5); if (sy > 0 && sy < h) ctx.fillText(v, 3, sy - 3); }
      ctx.stroke();
    }
  };
  lines(Math.min(c.xmin, c.xmax), Math.max(c.xmin, c.xmax), true);
  lines(Math.min(c.zmin, c.zmax), Math.max(c.zmin, c.zmax), false);
}
function pin(cx, cy, color, label, ring) {
  const [x, y] = imgToScr(cx, cy);
  ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, ring ? 9 : 6, 0, 7); ctx.fill(); ctx.stroke();
  if (ring) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x - 11, y); ctx.moveTo(x + 11, y); ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 11); ctx.moveTo(x, y + 11); ctx.lineTo(x, y + 16); ctx.stroke(); }
  if (label) { ctx.font = 'bold 12px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(label, x + 10, y - 8); ctx.fillStyle = '#fff'; ctx.fillText(label, x + 10, y - 8); }
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

function select(px, py) { S.sel = [px, py]; updateResult(); draw(); }
function updateResult() {
  if (!S.sel) { $('rx').textContent = $('rz').textContent = '—'; $('cmd').textContent = '/tp @s ~ ~ ~'; return; }
  const [px, py] = S.sel, [X, Z] = toMC(px, py);
  if (document.activeElement !== $('px')) $('px').value = px;
  if (document.activeElement !== $('py')) $('py').value = py;
  $('px').classList.remove('bad'); $('py').classList.remove('bad');
  $('rx').textContent = X; $('rz').textContent = Z; $('cmd').textContent = `/tp @s ${X} ~ ${Z}`;
}
function onPxInput() {
  const ok = (el, max) => { const v = el.value.trim(), n = Number(v); const g = v !== '' && Number.isInteger(n) && n >= 0 && n < max; el.classList.toggle('bad', !g); return g ? n : null; };
  const x = ok($('px'), S.W), y = ok($('py'), S.H);
  if (x !== null && y !== null) { S.sel = [x, y]; updateResult(); draw(); }
}
$('px').oninput = $('py').oninput = onPxInput;
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
$('c1').onclick = () => copy(1); $('c2').onclick = () => copy(2); $('c3').onclick = () => copy(3);

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
function flipUI() { $('fh').classList.toggle('on', S.fh); $('fv').classList.toggle('on', S.fv); }
function flip(h, v) {
  const cx = stage.clientWidth / 2, cy = stage.clientHeight / 2, [ix, iy] = scrToImg(cx, cy);
  if (h) S.fh = !S.fh; if (v) S.fv = !S.fv;
  const [nx, ny] = imgToScr(ix, iy); S.ox += cx - nx; S.oy += cy - ny; flipUI(); save(); draw();
}
$('fh').onclick = () => flip(1, 0); $('fv').onclick = () => flip(0, 1);
$('fr').onclick = () => { if (S.fh) flip(1, 0); if (S.fv) flip(0, 1); };

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

function setImage(img, name) {
  S.img = img; S.W = img.naturalWidth || img.width; S.H = img.naturalHeight || img.height;
  $('dims').textContent = `${name} · ${S.W} × ${S.H} px`; S.sel = null;
  $('px').value = $('py').value = ''; updateResult(); renderList(); fitView();
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

loadSaved(); prevM = mk(); if (EDIT) ghInit(); cfgToUI(); flipUI(); $('grid').checked = S.grid; $('gstep').value = S.gstep; renderList();
if (innerWidth <= 800) $('panel').classList.add('hidden');
resize(); loadDefault(); loadPois();
})();
